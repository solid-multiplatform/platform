import type { WebGlContextWrapper } from '../../lib/WebGlContextWrapper.js';
import { Default } from '../../shaders/webgl/Default.js';
import type { CoreShaderProgram } from '../CoreShaderProgram.js';
import type { SdfRenderOp } from './SdfRenderOp.js';
import type { WebGlCtxTexture } from './WebGlCtxTexture.js';
import type { WebGlRenderer, WebGlRenderOp } from './WebGlRenderer.js';
import type { WebGlShaderType } from './WebGlShaderNode.js';
import { WebGlShaderNode } from './WebGlShaderNode.js';
import type { BufferCollection } from './internal/BufferCollection.js';
import {
  createProgram,
  createShader,
  type UniformSet1Param,
  type UniformSet2Params,
  type UniformSet3Params,
  type UniformSet4Params,
} from './internal/ShaderUtils.js';
import { CoreNode } from '../../CoreNode.js';

export class WebGlShaderProgram implements CoreShaderProgram {
  protected program: WebGLProgram | null;
  protected renderer: WebGlRenderer;
  protected glw: WebGlContextWrapper;
  protected attributeLocations: string[];
  protected uniformLocations: Record<string, WebGLUniformLocation> | null;
  protected lifecycle: Pick<WebGlShaderType, 'update' | 'canBatch'>;
  protected useSystemAlpha = false;
  protected useSystemDimensions = false;
  protected useSystemTranslate = false;
  /**
   * The program grows its quad past the node (border and shadow shaders, see
   * `growQuadGlsl`), so it takes the node's 2x2 world transform
   * (`u_nodeTransform`) and the UV rect its quad samples (`u_uvRect`) as
   * per-draw system uniforms.
   */
  protected useSystemTransform = false;
  protected useSystemUvRect = false;
  protected useTimeValue = false;
  /**
   * The program declares `u_pixelRatio` / `u_resolution` and they have not
   * been uploaded yet. Built-in shaders compile the viewport in instead
   * (`viewportGlsl`); custom shaders written against the documented system
   * uniforms still get them, once, since neither value changes after
   * construction.
   */
  protected viewportUniformsPending = false;

  /**
   * Shadow copies of this program's GL uniform state, used by
   * {@link bindRenderOp} to skip redundant gl.uniform* calls.
   *
   * @remarks
   * GL uniform values are state on the program object and persist across
   * useProgram switches, and bindRenderOp is the only writer of these
   * uniforms, so the shadows always mirror GL truth — even when ops using
   * other programs are interleaved between two ops of this program.
   *
   * `lastBoundUniforms` tracks the shader node's uniform collection by
   * identity: collections are created once, filled once, and shared by
   * reference across shader nodes with the same value key (see
   * WebGlShaderNode.update), so reference equality implies value equality.
   * The failure direction is safe — a new collection holding identical
   * values just causes a redundant upload, never a wrong skip.
   *
   * Sentinels: -1 never collides with real alphas, dimensions, time values
   * or texture coords (all >= 0).
   */
  protected lastBoundUniforms: unknown = null;
  protected lastAlpha = -1;
  protected lastDimensionsW = -1;
  protected lastDimensionsH = -1;
  protected lastTime = -1;
  /**
   * The u_translate shadows start at NaN, not -1: a translation delta is the
   * one system uniform that can legitimately be negative (-1 included), and
   * NaN compares unequal to every value, so the first bind always uploads.
   */
  protected lastTranslateX = Number.NaN;
  protected lastTranslateY = Number.NaN;
  /** NaN as well: rotations and flips make transform components negative. */
  protected lastTransformA = Number.NaN;
  protected lastTransformB = Number.NaN;
  protected lastTransformC = Number.NaN;
  protected lastTransformD = Number.NaN;
  protected lastUvX1 = -1;
  protected lastUvY1 = -1;
  protected lastUvX2 = -1;
  protected lastUvY2 = -1;

  /**
   * Cached Vertex Array Objects, keyed by the buffer collection they capture.
   *
   * @remarks
   * A VAO records this program's attribute layout (enabled arrays, pointers and
   * their source buffers) plus the shared element index buffer, so a draw only
   * needs a single `bindVertexArray` instead of re-pointing every attribute. In
   * practice a program only ever binds one collection, but keying by collection
   * keeps it correct if that ever changes. Empty / unused when the context has
   * no VAO support (see {@link WebGlContextWrapper.canUseVertexArrayObject}).
   */
  protected vaos = new Map<BufferCollection, WebGLVertexArrayObject | null>();

  constructor(
    renderer: WebGlRenderer,
    config: WebGlShaderType,
    resolvedProps: Record<string, any>,
  ) {
    this.renderer = renderer;
    const glw = (this.glw = renderer.glw);

    // Check that required extensions are supported
    const requiredExtensions = config.webgl1Extensions || [];
    requiredExtensions.forEach((extensionName) => {
      if (!glw.getExtension(extensionName)) {
        throw new Error(
          `Shader "${this.constructor.name}" requires extension "${extensionName}" for WebGL 1.0 but wasn't found`,
        );
      }
    });

    const vertex = config.vertex ?? Default.vertex!;
    const vertexSource =
      vertex instanceof Function ? vertex(renderer, resolvedProps) : vertex;

    const fragmentSource =
      config.fragment instanceof Function
        ? config.fragment(renderer, resolvedProps)
        : config.fragment;

    const vertexShader = createShader(glw, glw.VERTEX_SHADER, vertexSource);
    if (!vertexShader) {
      throw new Error('Vertex shader creation failed');
    }

    const fragmentShader = createShader(
      glw,
      glw.FRAGMENT_SHADER,
      fragmentSource,
    );

    if (!fragmentShader) {
      throw new Error('fragment shader creation failed');
    }

    const program = createProgram(glw, vertexShader, fragmentShader);
    this.program = program;
    this.attributeLocations = glw.getAttributeLocations(program);

    const uniLocs = (this.uniformLocations = glw.getUniformLocations(program));

    this.useSystemAlpha = uniLocs['u_alpha'] !== undefined;
    this.useSystemDimensions = uniLocs['u_dimensions'] !== undefined;
    this.useSystemTranslate = uniLocs['u_translate'] !== undefined;
    this.useSystemTransform = uniLocs['u_nodeTransform'] !== undefined;
    this.useSystemUvRect = uniLocs['u_uvRect'] !== undefined;
    this.viewportUniformsPending =
      uniLocs['u_pixelRatio'] !== undefined ||
      uniLocs['u_resolution'] !== undefined;

    // Both halves are required: config.time is the shader type's opt-in, and
    // an active u_time proves the program actually consumes it. Keying this
    // off any other uniform freezes time shaders that lack that uniform and
    // taxes per-op binds for shaders that never read u_time.
    this.useTimeValue =
      uniLocs['u_time'] !== undefined && config.time !== undefined;

    this.lifecycle = {
      update: config.update,
      canBatch: config.canBatch,
    };
  }

  disableAttributes() {
    const glw = this.glw;
    const attribLen = this.attributeLocations.length;
    for (let i = 0; i < attribLen; i++) {
      glw.disableVertexAttribArray(i);
    }
  }

  reuseRenderOp(node: CoreNode, currentRenderOp: WebGlRenderOp): boolean {
    if (this.lifecycle.canBatch !== undefined) {
      return this.lifecycle.canBatch(node, currentRenderOp);
    }

    // Read node getters only for the system uniforms this program actually
    // uses — node.time in particular is a getter that runs per call.
    if (this.useTimeValue === true) {
      if (node.time !== currentRenderOp.time) {
        return false;
      }
    }

    if (this.useSystemAlpha === true) {
      if (node.worldAlpha !== currentRenderOp.worldAlpha) {
        return false;
      }
    }

    if (this.useSystemDimensions === true) {
      if (node.w !== currentRenderOp.w || node.h !== currentRenderOp.h) {
        return false;
      }
    }

    // One draw call uploads one node transform and one UV rect, so a batch
    // of growing quads must share both.
    if (this.useSystemTransform === true) {
      const a = node.globalTransform!;
      const b = (currentRenderOp as CoreNode).globalTransform!;
      if (a.ta !== b.ta || a.tb !== b.tb || a.tc !== b.tc || a.td !== b.td) {
        return false;
      }
    }

    if (this.useSystemUvRect === true) {
      const fallback = this.renderer.defaultTextureCoords;
      const a = node.textureCoords || fallback;
      const b = (currentRenderOp as CoreNode).textureCoords || fallback;
      if (
        a !== b &&
        (a.x1 !== b.x1 || a.y1 !== b.y1 || a.x2 !== b.x2 || a.y2 !== b.y2)
      ) {
        return false;
      }
    }

    const shader = node.props.shader as WebGlShaderNode | null;
    const opShader = currentRenderOp.shader as WebGlShaderNode | null;

    // Same shader node — same resolved props by definition.
    if (shader === opShader) {
      return true;
    }

    if (shader === null || opShader === null) {
      return false;
    }

    // Shader nodes with equal value keys share their uniform collection by
    // reference (see WebGlShaderNode.update); reference equality implies the
    // resolved prop values match. Distinct collections never batch — the
    // renderer already rejects them before calling in (WebGlRenderer
    // reuseRenderOp), so there is no key-by-key compare to fall back on.
    return shader.uniforms === opShader.uniforms;
  }

  /**
   * The buffer collection is passed in rather than read off the op: every
   * CoreNode resolved it through a getter that hopped to `stage.renderer` and
   * cast to the WebGL renderer, which made this a polymorphic access (getter
   * on CoreNode, plain field on SdfRenderOp). Both callers already hold the
   * collection.
   */
  bindRenderOp(renderOp: WebGlRenderOp, buffer: BufferCollection) {
    this.bindTexture(renderOp.renderOpTexture);
    this.bindBufferCollection(buffer);

    // Pixel ratio and canvas size are fixed at construction, so a program
    // that declares them needs them once. Each gl.uniform* call below crosses
    // into the GPU-process command buffer, so skipping value-identical
    // re-uploads is a real per-op CPU saving on embedded targets.
    if (this.viewportUniformsPending === true) {
      this.glw.uniform1f('u_pixelRatio', renderOp.stage.pixelRatio);
      this.glw.uniform2f('u_resolution', this.glw.canvasW, this.glw.canvasH);
      this.viewportUniformsPending = false;
    }

    if (this.useTimeValue === true && renderOp.time !== this.lastTime) {
      this.glw.uniform1f('u_time', renderOp.time);
      this.lastTime = renderOp.time;
    }

    if (
      this.useSystemAlpha === true &&
      renderOp.worldAlpha !== this.lastAlpha
    ) {
      this.glw.uniform1f('u_alpha', renderOp.worldAlpha);
      this.lastAlpha = renderOp.worldAlpha;
    }

    if (
      this.useSystemDimensions === true &&
      (renderOp.w !== this.lastDimensionsW ||
        renderOp.h !== this.lastDimensionsH)
    ) {
      this.glw.uniform2f('u_dimensions', renderOp.w, renderOp.h);
      this.lastDimensionsW = renderOp.w;
      this.lastDimensionsH = renderOp.h;
    }

    if (this.useSystemTransform === true) {
      // Only quads grow (see growQuadGlsl), so the op is a CoreNode
      const g = (renderOp as CoreNode).globalTransform!;
      if (
        g.ta !== this.lastTransformA ||
        g.tb !== this.lastTransformB ||
        g.tc !== this.lastTransformC ||
        g.td !== this.lastTransformD
      ) {
        // xy: the local x axis in world px, zw: the local y axis
        this.glw.uniform4f('u_nodeTransform', g.ta, g.tc, g.tb, g.td);
        this.lastTransformA = g.ta;
        this.lastTransformB = g.tb;
        this.lastTransformC = g.tc;
        this.lastTransformD = g.td;
      }
    }

    if (this.useSystemUvRect === true) {
      // The same coords addQuad wrote into the quad's vertices
      const tc =
        (renderOp as CoreNode).textureCoords ||
        this.renderer.defaultTextureCoords;
      if (
        tc.x1 !== this.lastUvX1 ||
        tc.y1 !== this.lastUvY1 ||
        tc.x2 !== this.lastUvX2 ||
        tc.y2 !== this.lastUvY2
      ) {
        this.glw.uniform4f('u_uvRect', tc.x1, tc.y1, tc.x2, tc.y2);
        this.lastUvX1 = tc.x1;
        this.lastUvY1 = tc.y1;
        this.lastUvX2 = tc.x2;
        this.lastUvY2 = tc.y2;
      }
    }

    if (this.useSystemTranslate === true) {
      // u_translate is a reserved system uniform: only the SDF program
      // declares it, and every op drawn with that program is an SdfRenderOp,
      // so the cast is safe. Shader types must not write it through their
      // uniform collections: bindRenderOp is its only writer.
      const op = renderOp as SdfRenderOp;
      if (
        op.translateX !== this.lastTranslateX ||
        op.translateY !== this.lastTranslateY
      ) {
        this.glw.uniform2f('u_translate', op.translateX, op.translateY);
        this.lastTranslateX = op.translateX;
        this.lastTranslateY = op.translateY;
      }
    }

    const shader = renderOp.shader as WebGlShaderNode;
    if (shader.props !== undefined) {
      /**
       * loop over all precalculated uniform types
       *
       * Collections are immutable after being filled and shared by reference
       * across shader nodes with equal value keys, so when the same object is
       * already bound the GL program still holds exactly these values and the
       * whole pass (loops + gl calls) can be skipped.
       */
      const uniforms = shader.uniforms;
      if ((uniforms as unknown) === this.lastBoundUniforms) {
        return;
      }
      this.lastBoundUniforms = uniforms;

      for (const key in uniforms.single) {
        const { method, value } = uniforms.single[key]!;
        this.glw[method as keyof UniformSet1Param](key, value as never);
      }

      for (const key in uniforms.vec2) {
        const { method, value } = uniforms.vec2[key]!;
        this.glw[method as keyof UniformSet2Params](key, value[0], value[1]);
      }

      for (const key in uniforms.vec3) {
        const { method, value } = uniforms.vec3[key]!;
        this.glw[method as keyof UniformSet3Params](
          key,
          value[0],
          value[1],
          value[2],
        );
      }

      for (const key in uniforms.vec4) {
        const { method, value } = uniforms.vec4[key]!;
        this.glw[method as keyof UniformSet4Params](
          key,
          value[0],
          value[1],
          value[2],
          value[3],
        );
      }
    }
  }

  bindBufferCollection(buffer: BufferCollection) {
    const { glw } = this;

    if (glw.canUseVertexArrayObject === true) {
      let vao = this.vaos.get(buffer);
      if (vao === undefined) {
        // First draw with this collection: try to capture the attribute layout
        // in a VAO. Cache the result — including a null on allocation failure,
        // so we don't retry createVertexArray every frame.
        vao = this.createVao(buffer);
        this.vaos.set(buffer, vao);
      }
      if (vao !== null) {
        // createVao leaves a freshly built VAO bound; re-binding is cheap and
        // keeps the build and reuse paths identical.
        glw.bindVertexArray(vao);
        return;
      }
      // VAO allocation failed (e.g. under GL OOM). Bind the default VAO so the
      // per-draw attribute setup below records into it rather than corrupting
      // another program's cached VAO, then fall through.
      glw.bindVertexArray(null);
    }

    // No (usable) VAO: re-point every attribute on each draw.
    this.bindAttributes(buffer);
  }

  /**
   * Point this program's vertex attributes at the given buffer collection.
   * When a VAO is bound this records into it; otherwise it mutates global state.
   */
  private bindAttributes(buffer: BufferCollection) {
    const { glw } = this;
    const attribs = this.attributeLocations;
    const attribLen = attribs.length;

    for (let i = 0; i < attribLen; i++) {
      const name = attribs[i]!;
      const resolvedBuffer = buffer.getBuffer(name);
      const resolvedInfo = buffer.getAttributeInfo(name);
      if (resolvedBuffer === undefined || resolvedInfo === undefined) {
        continue;
      }
      glw.enableVertexAttribArray(i);
      glw.vertexAttribPointer(
        resolvedBuffer,
        i,
        resolvedInfo.size,
        resolvedInfo.type,
        resolvedInfo.normalized,
        resolvedInfo.stride,
        resolvedInfo.offset,
      );
    }
  }

  /**
   * Create and populate a Vertex Array Object capturing this program's
   * attribute layout for the given buffer collection. The new VAO is left bound.
   * Returns null if the context reports VAO support but allocation fails (e.g.
   * under GL OOM), in which case the caller falls back to per-draw binding.
   */
  private createVao(buffer: BufferCollection): WebGLVertexArrayObject | null {
    const { glw } = this;
    const vao = glw.createVertexArray();
    if (vao === null) {
      return null;
    }
    glw.bindVertexArray(vao);

    this.bindAttributes(buffer);

    // The element-array binding is part of VAO state and starts out null on a
    // fresh VAO, so record the shared index buffer into it or indexed
    // drawElements would read from no buffer.
    glw.bindElementArrayBuffer(this.renderer.indexBuffer);

    return vao;
  }

  /**
   * A render op binds exactly one texture. The undefined check is not dead
   * defensiveness: a GPU OOM releases a Texture and clears its ctxTexture, so
   * the op can be holding a stale reference by the time it draws.
   */
  bindTexture(texture: WebGlCtxTexture | null) {
    if (texture === null || texture === undefined) {
      return;
    }
    this.glw.activeTexture(0);
    this.glw.bindTexture(texture.ctxTexture);
  }

  attach(): void {
    this.glw.useProgram(this.program, this.uniformLocations!);
  }

  detach(): void {
    // With VAOs the enabled-attribute state lives in each per-collection VAO,
    // not in global context state. Disabling here would mutate whichever VAO is
    // currently bound and corrupt it for the next draw, so there's nothing to
    // do on a program switch.
    if (this.glw.canUseVertexArrayObject === true) {
      return;
    }
    this.disableAttributes();
  }
}
