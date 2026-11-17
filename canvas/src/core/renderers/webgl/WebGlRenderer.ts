import { createWebGLContext, RENDER_TEXT_BATCHING } from '../../../utils.js';
import {
  CoreRenderer,
  type BufferInfo,
  type CoreRendererOptions,
  type RendererCapabilities,
} from '../CoreRenderer.js';
import { SdfRenderOp } from './SdfRenderOp.js';
import type { CoreContextTexture } from '../CoreContextTexture.js';
import {
  BYTES_PER_QUAD,
  createIndexBuffer,
  createTextureCoords,
  UNIT_TEXTURE_COORDS,
  BYTES_PER_VERTEX,
  MAX_QUADS,
  MAX_QUAD_BUFFER_SIZE,
  WORDS_PER_QUAD,
  type WebGlColor,
} from './internal/RendererUtils.js';
import { WebGlCtxTexture } from './WebGlCtxTexture.js';
import {
  Texture,
  TextureType,
  type TextureCoords,
} from '../../textures/Texture.js';
import type { SubTexture } from '../../textures/SubTexture.js';
import { WebGlCtxSubTexture } from './WebGlCtxSubTexture.js';
import { BufferCollection } from './internal/BufferCollection.js';
import {
  compareRect,
  getNormalizedRgbaComponents,
  type Bound,
} from '../../lib/utils.js';
import { resolveUvRect } from '../uvRect.js';
import { WebGlShaderProgram } from './WebGlShaderProgram.js';
import { WebGlContextWrapper } from '../../lib/WebGlContextWrapper.js';
import { CoreNode } from '../../CoreNode.js';
import { Default } from '../../shaders/webgl/Default.js';
import type { WebGlShaderType } from './WebGlShaderNode.js';
import { WebGlShaderNode } from './WebGlShaderNode.js';
import type { Matrix3d } from '../../lib/Matrix3d.js';

export type WebGlRendererOptions = CoreRendererOptions;

// Scratch for resolveUvRect: getTextureCoords copies the result out.
const uvScratch: Bound = { x1: 0, y1: 0, x2: 1, y2: 1 };

const GL_OUT_OF_MEMORY = 0x0505;

/**
 * Upper bound on how many queued GL errors we drain per frame in
 * {@link WebGlRenderer.checkForOutOfMemory}. Keeps the per-frame `getError()`
 * sync cost fixed even if the error queue is unexpectedly deep.
 */
const MAX_DRAINED_GL_ERRORS = 8;

/**
 * Float32 elements per SDF glyph: 4 vertices x 6 floats (x, y, u, v, packed
 * color, distanceRange) = 96 bytes.
 */
const FLOATS_PER_GLYPH = 24;

/**
 * Initial capacity of the shared SDF vertex buffer, in bytes. Holds ~2730
 * glyphs, several times a dense screen of TV text, so typical scenes never
 * pay a growth reallocation.
 */
const SDF_BUFFER_SIZE = 256 * 1024;

/**
 * Hard bound on SDF buffer growth, in bytes (~10920 glyphs).
 *
 * @remarks
 * Growth doubles from {@link SDF_BUFFER_SIZE} and stops here. The buffer never
 * shrinks, so an unbounded doubling would let one pathological frame hold
 * multiple megabytes for the rest of the session. A glyph run that does not fit
 * within the bound is skipped for that frame rather than partially written —
 * the same outcome as the 16384-quad index ceiling, which caps drawable glyphs
 * below this anyway.
 */
const MAX_SDF_BUFFER_SIZE = 1024 * 1024;

const MAX_SDF_BUFFER_FLOATS =
  MAX_SDF_BUFFER_SIZE / Float32Array.BYTES_PER_ELEMENT;

export type WebGlRenderOp = CoreNode | SdfRenderOp;

export class WebGlRenderer extends CoreRenderer {
  //// WebGL Native Context and Data
  glw: WebGlContextWrapper;

  //// Persistent data
  /**
   * Main quad vertex buffer. Layout per vertex (5 x 32-bit words = 20 bytes,
   * so 80 bytes per quad — see {@link BYTES_PER_QUAD}):
   *   [0] x (float32)  - world pixel X
   *   [1] y (float32)  - world pixel Y
   *   [2] u (float32)  - texture U
   *   [3] v (float32)  - texture V
   *   [4] color (uint32) - ABGR packed, read as vec4 normalized
   *
   * `fQuadBuffer` and `uiQuadBuffer` alias the same ArrayBuffer; words 0-3 are
   * written through the float view, word 4 through the uint view.
   */
  quadBuffer: ArrayBuffer;
  fQuadBuffer: Float32Array;
  uiQuadBuffer: Uint32Array;
  renderOps: WebGlRenderOp[] = [];
  /**
   * Deferred queue for SDF text render ops, used when RENDER_TEXT_BATCHING is
   * true. All text encountered during the frame is collected here and appended
   * to renderOps at the end (see flushTextRenderOps). This guarantees that all
   * text in a frame draws in a single contiguous run of draw calls, which is
   * the whole point of text batching.
   *
   * Side effect by design: text always draws on top of any non-text quads that
   * came after it in tree order (unless those quads carry an explicit zIndex,
   * which forces an early flush in addQuad). This is intentional — UI text
   * sitting above adjacent backgrounds/icons is the common case, and the
   * batching win is only worth taking if we don't break the run with mid-frame
   * flushes. If you need a non-text quad to land above earlier text, give it
   * a non-zero zIndex.
   */
  coreTextRenderOps: WebGlRenderOp[] = [];

  /**
   * Grow-only pool of SdfRenderOp instances, indexed by {@link sdfOpPoolIdx}.
   * finalizeSdfBatch takes the next instance and reinitializes every field
   * via SdfRenderOp.init, so a text-heavy screen allocates ops only until its
   * peak batch count and never again. The pool never shrinks (same philosophy
   * as the vertex buffers) and instances are never handed back mid-frame.
   */
  sdfOpPool: SdfRenderOp[] = [];
  /**
   * Next pool slot finalizeSdfBatch hands out. Rewound in {@link reset}
   * alongside the op-list clear; see the invariant comment there.
   */
  sdfOpPoolIdx = 0;

  //// Render Op / Buffer Filling State
  curBufferIdx = 0;
  curRenderOp: WebGlRenderOp | null = null;
  /**
   * The shader program currently bound to the GL context.
   *
   * @remarks
   * Deliberately not cleared in `reset()`: a GL program binding survives the
   * frame boundary, so the redundant-bind skip in `useShader` stays valid
   * across frames.
   */
  private attachedShader: WebGlShaderProgram | null = null;

  //// Shared SDF Buffer
  /**
   * Shared vertex buffer for all SDF text glyphs.
   * Layout per vertex (6 floats = 24 bytes):
   *   [0] x (float) - world pixel X
   *   [1] y (float) - world pixel Y
   *   [2] u (float) - atlas U
   *   [3] v (float) - atlas V
   *   [4] color (uint32) - ABGR packed, read as vec4 normalized
   *   [5] distRange (float) - SDF distance range
   *
   * 4 vertices per glyph → 24 float units per glyph.
   * Triangles are formed via the shared element index buffer.
   */
  sdfBuffer: ArrayBuffer;
  fSdfBuffer: Float32Array;
  uiSdfBuffer: Uint32Array;
  sdfBufferIdx = 0;
  /** Running count of SDF quads written this frame (for element offset). */
  sdfQuadCount = 0;
  sdfQuadBufferCollection: BufferCollection;
  curSdfRenderOp: SdfRenderOp | null = null;
  /**
   * Whether the shared SDF buffer's bytes may differ from what the GPU
   * currently holds. Set by every write path that produces fresh bytes
   * (cache-miss recompute, the settle-time delta fold in
   * {@link SdfTextRenderer}), by anything that can shift offsets or resize
   * the buffer (render-list rebuild, backing-store growth), and consumed by
   * {@link uploadSdfBuffer}.
   *
   * The cache-hit mem-copy path does NOT set it: it writes each node's cache
   * bytes unmodified regardless of position, because a moved node's delta
   * rides its render op as the u_translate uniform instead of being added
   * into the vertices. The bytes are therefore position-independent and match
   * the previous frame whenever the same caches were written in the same
   * order, which the size and fingerprint halves of the skip test confirm.
   * Conservative direction: when in doubt, set it. A redundant upload is
   * correct, a wrong skip is a glitch.
   */
  sdfBufferChanged = true;
  /**
   * Float32 length of the last main-pass SDF upload — the size half of the
   * skip test in {@link uploadSdfBuffer}.
   */
  lastUploadedSdfSize = 0;
  /**
   * Order-sensitive fingerprint of this frame's SDF writes (each batch's glyph
   * count folded in write order), reset every frame in {@link reset}. Equal
   * total size does not imply equal layout: a different set of text nodes, or
   * the same set in a different order, can land on the same `sdfBufferIdx`
   * while every glyph sits at a different offset. Comparing the fingerprint
   * keeps the skip decision derived from what the renderer actually did this
   * frame rather than from scene-graph hooks firing correctly.
   */
  sdfWriteSig = 0;
  /** {@link sdfWriteSig} at the time of the last main-pass SDF upload. */
  lastUploadedSdfSig = 0;

  // Shared by every quad whose texture has no options and is not a SubTexture
  // — the overwhelmingly common case.
  override defaultTextureCoords: Readonly<TextureCoords> = UNIT_TEXTURE_COORDS;

  //// Default Shader
  defaultShaderNode: WebGlShaderNode | null = null;
  quadBufferCollection: BufferCollection;

  /**
   * Shared static element (index) buffer for quad rendering.
   *
   * @remarks
   * Bound once globally, but also recorded into each shader program's Vertex
   * Array Object since the element-array binding is part of VAO state.
   */
  indexBuffer: WebGLBuffer | null = null;

  clearColor: WebGlColor = {
    raw: 0x00000000,
    normalized: [0, 0, 0, 0],
  };

  /**
   * White pixel texture used by default when no texture is specified.
   */

  quadBufferUsage = 0;
  numQuadsRendered = 0;

  /**
   * Cached view over {@link quadBuffer} for the per-frame upload.
   *
   * @remarks
   * Rebuilt only when the number of words written changes, which is when the
   * quad count does. `quadBuffer` is allocated once in the constructor and
   * never replaced, so the view stays valid for the renderer's lifetime and a
   * steady scene uploads without allocating.
   */
  private quadUploadView: Float32Array | null = null;

  /**
   * Byte size of `quadBuffer`.
   *
   * @remarks
   * `stage.options.quadBufferSize` clamped to {@link MAX_QUAD_BUFFER_SIZE}.
   * Bytes past that ceiling are unreachable — their quads fall outside the
   * Uint16 index range — so allocating them only costs heap on the most
   * constrained devices.
   */
  quadBufferSize: number;

  constructor(options: WebGlRendererOptions) {
    super(options);

    // CPU-side vertex buffers, reused every frame. Their GL buffers and
    // BufferCollections are wired up below, once the GL context exists.
    this.quadBufferSize = Math.min(
      this.stage.options.quadBufferSize,
      MAX_QUAD_BUFFER_SIZE,
    );
    this.quadBuffer = new ArrayBuffer(this.quadBufferSize);
    this.fQuadBuffer = new Float32Array(this.quadBuffer);
    this.uiQuadBuffer = new Uint32Array(this.quadBuffer);

    // Shared SDF vertex buffer, grown on demand up to MAX_SDF_BUFFER_SIZE.
    this.sdfBuffer = new ArrayBuffer(SDF_BUFFER_SIZE);
    this.fSdfBuffer = new Float32Array(this.sdfBuffer);
    this.uiSdfBuffer = new Uint32Array(this.sdfBuffer);

    this.mode = 'webgl';

    const gl = createWebGLContext(
      options.canvas,
      options.forceWebGL2,
      options.contextSpy,
      options.powerPreference,
    );
    const glw = (this.glw = new WebGlContextWrapper(
      gl,
      options.disableVertexArrayObject,
    ));
    glw.viewport(0, 0, glw.canvasW, glw.canvasH);

    this.attachContextLossListeners(options.canvas);

    this.updateClearColor(this.stage.clearColor);

    glw.setBlend(true);
    glw.blendFunc(glw.ONE, glw.ONE_MINUS_SRC_ALPHA);

    this.indexBuffer = createIndexBuffer(glw);

    // Static node coords buffer: one entry per addressable quad slot, matching
    // the index buffer exactly (@see RendererUtils.ts). Sizing it from any
    // other budget either wastes heap or truncates geometry.
    const nodeCoords = new Float32Array(MAX_QUADS * 8);
    for (let i = 0; i < MAX_QUADS * 8; i += 8) {
      nodeCoords[i] = 0;
      nodeCoords[i + 1] = 0;
      nodeCoords[i + 2] = 1;
      nodeCoords[i + 3] = 0;
      nodeCoords[i + 4] = 0;
      nodeCoords[i + 5] = 1;
      nodeCoords[i + 6] = 1;
      nodeCoords[i + 7] = 1;
    }
    const nodeCoordsBuffer = glw.createBuffer();
    glw.arrayBufferData(nodeCoordsBuffer, nodeCoords, glw.STATIC_DRAW);

    const quadBuffer = glw.createBuffer();
    // Every offset below, and the stride itself, is 4-byte aligned — a
    // misaligned vertex attribute pushes Mali/ES2 drivers onto a CPU repack
    // path. @see BYTES_PER_VERTEX for the full layout.
    const stride = BYTES_PER_VERTEX;
    this.quadBufferCollection = new BufferCollection([
      {
        buffer: quadBuffer!,
        attributes: {
          a_position: {
            name: 'a_position',
            size: 2, // 2 components per iteration
            type: glw.FLOAT, // the data is 32bit floats
            normalized: false, // don't normalize the data
            stride, // 0 = move forward size * sizeof(type) each iteration to get the next position
            offset: 0, // start at the beginning of the buffer
          },
          a_textureCoords: {
            name: 'a_textureCoords',
            size: 2,
            // FLOAT, not normalized UNSIGNED_SHORT: see BYTES_PER_VERTEX.
            type: glw.FLOAT,
            normalized: false,
            stride,
            offset: 8,
          },
          a_color: {
            name: 'a_color',
            size: 4,
            type: glw.UNSIGNED_BYTE,
            normalized: true,
            stride,
            offset: 16,
          },
        },
      },
      {
        buffer: nodeCoordsBuffer!,
        attributes: {
          a_nodeCoords: {
            name: 'a_nodeCoords',
            size: 2,
            type: glw.FLOAT,
            normalized: false,
            stride: 2 * Float32Array.BYTES_PER_ELEMENT,
            offset: 0,
          },
        },
      },
    ]);

    // --- Shared SDF buffer collection (CPU buffer allocated above) ----------
    const sdfWebGlBuffer = glw.createBuffer();
    const sdfStride = 6 * Float32Array.BYTES_PER_ELEMENT; // 24 bytes
    this.sdfQuadBufferCollection = new BufferCollection([
      {
        buffer: sdfWebGlBuffer!,
        attributes: {
          a_position: {
            name: 'a_position',
            size: 2,
            type: glw.FLOAT,
            normalized: false,
            stride: sdfStride,
            offset: 0,
          },
          a_textureCoords: {
            name: 'a_textureCoords',
            size: 2,
            type: glw.FLOAT,
            normalized: false,
            stride: sdfStride,
            offset: 2 * Float32Array.BYTES_PER_ELEMENT,
          },
          a_color: {
            name: 'a_color',
            size: 4,
            type: glw.UNSIGNED_BYTE,
            normalized: true,
            stride: sdfStride,
            offset: 4 * Float32Array.BYTES_PER_ELEMENT,
          },
          a_distRange: {
            name: 'a_distRange',
            size: 1,
            type: glw.FLOAT,
            normalized: false,
            stride: sdfStride,
            offset: 5 * Float32Array.BYTES_PER_ELEMENT,
          },
        },
      },
    ]);
  }

  /**
   * Listen for WebGL context loss on the canvas.
   *
   * @remarks
   * On low-RAM devices (e.g. Chromium 123+ after backgrounding) the GPU
   * context is dropped, after which `gl.createTexture()` and friends return
   * null and the engine would crash. We pause the render loop via the Stage
   * flag and surface a `contextLost` event so consumers can react.
   *
   * We intentionally do NOT call `event.preventDefault()` (which would ask the
   * browser to restore the context) and do NOT listen for
   * `webglcontextrestored`: the engine cannot rebuild its GPU resources
   * in-place, so the supported recovery is to reload the app. See BROWSERS.md.
   */
  private attachContextLossListeners(
    canvas: HTMLCanvasElement | OffscreenCanvas,
  ): void {
    if ('addEventListener' in canvas === false) {
      return;
    }
    const target = canvas as HTMLCanvasElement;
    target.addEventListener('webglcontextlost', () => {
      this.stage.setContextLost();
    });
  }

  reset() {
    const { glw } = this;
    this.curBufferIdx = 0;
    this.curRenderOp = null;
    this.curSdfRenderOp = null;
    this.sdfBufferIdx = 0;
    this.sdfQuadCount = 0;
    this.sdfWriteSig = 0;
    this.renderOps.length = 0;
    this.coreTextRenderOps.length = 0;
    // Rewinding the SDF op pool cursor is safe exactly here because the two
    // list clears above (plus the curSdfRenderOp null) drop the only
    // references to pooled SdfRenderOp instances, so nothing can alias an op
    // that the coming fill pass reinitializes. INVARIANT for future work: a
    // feature that retains renderOps across frames (replaying last frame's
    // list without a fill pass) must NOT rewind this cursor on frames that
    // keep the retained list, and must rewind it only where the list itself
    // is cleared; otherwise the next fill would reinitialize instances the
    // retained list still references.
    this.sdfOpPoolIdx = 0;
    glw.setScissorTest(false);
    // Always clear. Skipping it was measurably no faster on a tile-based TV GPU
    // (an A/B/A run separated by less than the session's own drift), and a
    // frame-start clear is what lets a tiler discard the previous tile buffer
    // rather than reloading it -- so the "skip work" framing was backwards.
    glw.clear();
  }

  createShaderProgram(
    shaderType: WebGlShaderType,
    props: Record<string, unknown>,
  ): WebGlShaderProgram {
    try {
      return new WebGlShaderProgram(this, shaderType, props);
    } catch (e) {
      // A lost GL context makes shader creation/compilation fail synchronously
      // (gl.createShader returns null -> CONTEXT_LOST_WEBGL). This can run on
      // the app's reactive stack before the async `webglcontextlost` event is
      // processed, so trip the flag here too. setContextLost() is idempotent
      // and emits `contextLost` for consumers (recovery is an app reload).
      if (this.glw.isContextLost() === true) {
        this.stage.setContextLost();
      }
      throw e;
    }
  }

  createShaderNode(
    shaderKey: string,
    shaderType: WebGlShaderType,
    props?: Record<string, unknown>,
    program?: WebGlShaderProgram,
  ) {
    return new WebGlShaderNode(
      shaderKey,
      shaderType,
      program!,
      this.stage,
      props,
    );
  }

  override supportsShaderType(shaderType: Readonly<WebGlShaderType>): boolean {
    //if shadertype doesnt have a fragment source we cant use it
    return shaderType.fragment !== undefined;
  }

  createCtxTexture(textureSource: Texture): CoreContextTexture {
    // Discriminate on `type` rather than `instanceof` so the SubTexture class
    // stays a type-only import here. An `instanceof` is a value reference that
    // pins the class into every bundle. Matches how the rest of this file and
    // CanvasRenderer already branch on subtextures.
    if (textureSource.type === TextureType.subTexture) {
      return new WebGlCtxSubTexture(
        this.glw,
        this.stage.txMemManager,
        textureSource as SubTexture,
      );
    }
    return new WebGlCtxTexture(
      this.glw,
      this.stage.txMemManager,
      textureSource,
    );
  }

  /**
   * This function adds a quad (a rectangle composed of two triangles) to the WebGL rendering pipeline.
   *
   * It takes a set of options that define the quad's properties, such as its dimensions, colors, texture, shader, and transformation matrix.
   * The function first updates the shader properties with the current dimensions if necessary, then sets the default texture if none is provided.
   * It then checks if a new render operation is needed, based on the current shader and clipping rectangle.
   * If a new render operation is needed, it creates one and updates the current render operation.
   * The function then adjusts the texture coordinates based on the texture options and adds the texture to the texture manager.
   *
   * Finally, it calculates the vertices for the quad, taking into account any transformations, and adds them to the quad buffer.
   * The function updates the length and number of quads in the current render operation, and updates the current buffer index.
   */
  addQuad(node: CoreNode, texture?: Texture) {
    const f = this.fQuadBuffer;
    const u = this.uiQuadBuffer;
    const props = node.props;

    // Explicit zIndex on a non-text quad opts out of the text-batching
    // ordering: flush deferred text now so this quad lands above any text
    // that came earlier in tree order. See coreTextRenderOps for the
    // intentional default behavior.
    if (RENDER_TEXT_BATCHING === true && props.zIndex) {
      this.flushTextRenderOps();
    }

    // With batching off, SDF ops live inside renderOps interleaved with quad
    // ops. A non-text quad inserted here would otherwise still let the next
    // text node extend the previous SDF op (same atlas/clipping), drawing
    // those glyphs at the earlier position and getting overdrawn by this quad.
    if (RENDER_TEXT_BATCHING === false) {
      this.curSdfRenderOp = null;
    }

    // Already resolved by CoreNode.renderQuads on the frame path (it needs the
    // texture for its own `state` check). While a placeholder is showing, the
    // quad samples the shared 1x1 white texture tinted by the node's
    // premultiplied placeholder color.
    let tx =
      texture !== undefined
        ? texture
        : node.placeholderActive === true
        ? this.stage.defaultTexture!
        : props.texture || this.stage.defaultTexture!;

    if (tx.type === TextureType.subTexture) {
      tx = (tx as SubTexture).parentTexture;
    }

    const ctx = tx.ctxTexture as WebGlCtxTexture | undefined;
    if (ctx === undefined) {
      return;
    }

    const reuse = this.reuseRenderOp(node);

    // The buffer is rebuilt from scratch every frame, so each quad simply takes
    // the next slot in render-list order.
    const i = this.curBufferIdx;
    this.curBufferIdx += WORDS_PER_QUAD;

    if (reuse === false) {
      this.newRenderOp(node, i);
    }

    // A draw call samples one texture unit (WebGlShaderProgram.bindTexture),
    // so the op takes this texture if it has none yet and otherwise has to be
    // split when the node's texture differs. curRenderOp is always a CoreNode
    // here: finalizeSdfBatch nulls it out whenever an SdfRenderOp takes over.
    let curOp = this.curRenderOp as CoreNode;
    if (curOp.renderOpTexture === null) {
      curOp.renderOpTexture = ctx;
    } else if (curOp.renderOpTexture !== ctx) {
      this.newRenderOp(node, i);
      node.renderOpTexture = ctx;
      curOp = node;
    }

    // The quad buffer is rebuilt from scratch each frame, so every quad in
    // the render list is written unconditionally.
    const rc = node.renderCoords!;
    const tc = node.textureCoords || this.defaultTextureCoords;
    const u1 = tc.x1;
    const v1 = tc.y1;
    const u2 = tc.x2;
    const v2 = tc.y2;

    const cTl = node.premultipliedColorTl;
    const cTr = node.premultipliedColorTr;
    const cBl = node.premultipliedColorBl;
    const cBr = node.premultipliedColorBr;

    // Upper-Left
    f[i] = rc.x1;
    f[i + 1] = rc.y1;
    f[i + 2] = u1;
    f[i + 3] = v1;
    u[i + 4] = cTl;

    // Upper-Right
    f[i + 5] = rc.x2;
    f[i + 6] = rc.y2;
    f[i + 7] = u2;
    f[i + 8] = v1;
    u[i + 9] = cTr;

    // Lower-Left
    f[i + 10] = rc.x4;
    f[i + 11] = rc.y4;
    f[i + 12] = u1;
    f[i + 13] = v2;
    u[i + 14] = cBl;

    // Lower-Right
    f[i + 15] = rc.x3;
    f[i + 16] = rc.y3;
    f[i + 17] = u2;
    f[i + 18] = v2;
    u[i + 19] = cBr;

    curOp.numQuads++;
  }

  /**
   * Replace the existing RenderOp with a new one that uses the specified Shader
   * and starts at the specified buffer index.
   *
   * @param shader
   * @param bufferIdx
   */
  private newRenderOp(node: CoreNode, bufferIdx: number) {
    const curRenderOp = node;
    curRenderOp.renderOpBufferIdx = bufferIdx;
    curRenderOp.numQuads = 0;
    curRenderOp.renderOpTexture = null;

    this.curRenderOp = curRenderOp;
    this.renderOps.push(curRenderOp);
  }

  /**
   * Test if the current Render operation can be reused for the specified parameters.
   * @param params
   * @returns
   */
  reuseRenderOp(node: CoreNode): boolean {
    const curRenderOp = this.curRenderOp;
    if (curRenderOp === null) {
      return false;
    }

    // Correctness checks first — these MUST pass regardless of shader.
    // Clipping rect differences can't be batched: the draw call applies one
    // scissor to every quad in the op.

    // Switching clipping rect will require a new render operation
    if (compareRect(curRenderOp.clippingRect, node.clippingRect) === false) {
      return false;
    }

    const shader = node.props.shader as WebGlShaderNode;
    const curShader = curRenderOp.shader as WebGlShaderNode;

    if (curShader.shaderKey === 'default' && shader.shaderKey === 'default') {
      return true;
    }

    // Distinct shader nodes can still batch when they resolve to the same
    // program and the value-key cache handed both the same uniform collection:
    // collections are immutable after fill and shared by reference across
    // equal value keys, so reference equality implies value equality. This is
    // the common TV-rail case — many same-size cards, each app-created with
    // its own shader node but equal props. Program identity is required
    // because the value key does not include the shader type, so equal
    // collections from different programs must not merge.
    if (curShader !== shader) {
      if (
        curShader.program !== shader.program ||
        curShader.uniforms !== shader.uniforms
      ) {
        return false;
      }
    }

    // Check if the shader can batch the shader properties
    if (curShader.program.reuseRenderOp(node, curRenderOp) === false) {
      return false;
    }

    return true;
  }

  /**
   * add RenderOp to the render pipeline
   */
  addRenderOp(renderable: WebGlRenderOp) {
    if (RENDER_TEXT_BATCHING === true) {
      // We are batching text nodes to be added later
      this.coreTextRenderOps.push(renderable);
      return;
    }
    this.renderOps.push(renderable);
    this.curRenderOp = null;
  }

  flushTextRenderOps() {
    const len = this.coreTextRenderOps.length;
    if (len === 0) {
      return;
    }
    for (let i = 0; i < len; i++) {
      this.renderOps.push(this.coreTextRenderOps[i]!);
    }
    this.coreTextRenderOps.length = 0;
    this.curRenderOp = null;
    this.curSdfRenderOp = null;
  }

  /**
   * Append pre-transformed SDF glyph vertices to the shared SDF buffer
   * and manage SDF render op batching.
   *
   * @remarks
   * This method pre-transforms glyph positions from design units to world
   * pixel space on the CPU, packs per-vertex color and distanceRange, and
   * writes them into the shared SDF buffer. Compatible consecutive calls
   * (same atlas, same clipping) are merged into a single SdfRenderOp,
   * resulting in one draw call for many text nodes.
   */
  addSdfQuads(
    glyphs: Float32Array,
    glyphCount: number,
    fontScale: number,
    transform: Matrix3d,
    color: number,
    worldAlpha: number,
    distanceRange: number,
    atlasTexture: WebGlCtxTexture,
    clippingRect: import('../../lib/utils.js').ClipRect,
    width: number,
    height: number,
    sdfShader: WebGlShaderNode,
  ): void {
    if (glyphCount === 0) {
      return;
    }

    // Full recompute writes fresh bytes — the GPU copy is now stale.
    this.sdfBufferChanged = true;

    let idx = this.sdfBufferIdx;
    if (
      this.ensureSdfBufferCapacity(idx + glyphCount * FLOATS_PER_GLYPH) ===
      false
    ) {
      return;
    }

    const f = this.fSdfBuffer;
    const u = this.uiSdfBuffer;

    // Pre-compute the node color packed as ABGR for the UNSIGNED_BYTE
    // normalized attribute. worldAlpha is deliberately NOT baked in: it rides
    // the render op as the u_alpha system uniform, so an alpha fade never
    // dirties the cached vertex bytes.
    // NOTE: Do NOT premultiply RGB by alpha here. The SDF fragment shader
    // already multiplies v_color.rgb by the computed opacity (which includes
    // v_color.a, itself scaled by u_alpha in the vertex shader).
    const r = color >>> 24;
    const g = (color >>> 16) & 0xff;
    const b = (color >>> 8) & 0xff;
    const a = color & 0xff;
    // Pack as ABGR uint32 (little-endian read as vec4(r,g,b,a) normalized)
    const packedColor = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

    // Transform matrix components, read straight off the node's global
    // transform. Pre-multiply fontScale here to save 4 multiplications per
    // glyph in the hot loop.
    const m0 = transform.ta * fontScale;
    const m1 = transform.tc * fontScale;
    const m3 = transform.tb * fontScale;
    const m4 = transform.td * fontScale;
    const m6 = transform.tx;
    const m7 = transform.ty;

    // Record start quad for this batch segment
    const startQuad = this.sdfQuadCount;

    // Read packed glyph fields directly from the Float32Array (stride = 8).
    let go = 0;
    for (let gi = 0; gi < glyphCount; gi++) {
      // Glyph corners in design units
      const gx1 = glyphs[go]!;
      const gy1 = glyphs[go + 1]!;
      const gx2 = gx1 + glyphs[go + 2]!;
      const gy2 = gy1 + glyphs[go + 3]!;

      // Atlas UVs
      const u1 = glyphs[go + 4]!;
      const v1 = glyphs[go + 5]!;
      const u2 = u1 + glyphs[go + 6]!;
      const v2 = v1 + glyphs[go + 7]!;
      go += 8;

      // Transform to world space
      // Note: we use gx/y directly since m0,m1,m3,m4 are already pre-scaled
      // Top-left
      const wx_tl = m0 * gx1 + m3 * gy1 + m6;
      const wy_tl = m1 * gx1 + m4 * gy1 + m7;
      // Top-right
      const wx_tr = m0 * gx2 + m3 * gy1 + m6;
      const wy_tr = m1 * gx2 + m4 * gy1 + m7;
      // Bottom-left
      const wx_bl = m0 * gx1 + m3 * gy2 + m6;
      const wy_bl = m1 * gx1 + m4 * gy2 + m7;
      // Bottom-right
      const wx_br = m0 * gx2 + m3 * gy2 + m6;
      const wy_br = m1 * gx2 + m4 * gy2 + m7;

      // 4 vertices per glyph: TL, TR, BL, BR
      // Index buffer supplies the two-triangle winding: [0,1,2, 2,1,3]
      f[idx] = wx_tl;
      f[idx + 1] = wy_tl;
      f[idx + 2] = u1;
      f[idx + 3] = v1;
      u[idx + 4] = packedColor;
      f[idx + 5] = distanceRange;
      idx += 6;
      f[idx] = wx_tr;
      f[idx + 1] = wy_tr;
      f[idx + 2] = u2;
      f[idx + 3] = v1;
      u[idx + 4] = packedColor;
      f[idx + 5] = distanceRange;
      idx += 6;
      f[idx] = wx_bl;
      f[idx + 1] = wy_bl;
      f[idx + 2] = u1;
      f[idx + 3] = v2;
      u[idx + 4] = packedColor;
      f[idx + 5] = distanceRange;
      idx += 6;
      f[idx] = wx_br;
      f[idx + 1] = wy_br;
      f[idx + 2] = u2;
      f[idx + 3] = v2;
      u[idx + 4] = packedColor;
      f[idx + 5] = distanceRange;
      idx += 6;
    }

    this.sdfBufferIdx = idx;
    this.sdfQuadCount += glyphCount;

    this.finalizeSdfBatch(
      startQuad,
      glyphCount,
      // Freshly computed vertices carry their full transform; no delta.
      0,
      0,
      atlasTexture,
      clippingRect,
      worldAlpha,
      width,
      height,
      sdfShader,
    );
  }

  /**
   * Fast path: copy pre-computed cached SDF vertex data into the shared
   * buffer and create/extend an SdfRenderOp carrying the node's translation
   * delta.
   *
   * @remarks
   * When a text node's layout, linear transform, color and alpha are
   * unchanged, the per-glyph matrix multiplication is skipped entirely. The
   * cached Float32Array is written via a single `Float32Array.set()`
   * (memcpy) regardless of position: a node that moved by pure translation
   * since its cache was built (the scroll path) hands the delta to the
   * render op, where it reaches the vertex shader as the per-op u_translate
   * uniform. Byte-identical rewrites are what let {@link uploadSdfBuffer}
   * skip the per-frame `bufferData`, so this path must never modify the
   * copied bytes and never raises `sdfBufferChanged`.
   *
   * The copy MUST stay a typed-array `set` (bit-exact memcpy): packed ABGR
   * colors live in the same Float32Array and some bit patterns are float32
   * NaNs, which element-wise float reads/writes may canonicalize and corrupt.
   */
  addSdfCachedQuads(
    cachedVertices: Float32Array,
    numGlyphs: number,
    dx: number,
    dy: number,
    atlasTexture: WebGlCtxTexture,
    clippingRect: import('../../lib/utils.js').ClipRect,
    worldAlpha: number,
    width: number,
    height: number,
    sdfShader: WebGlShaderNode,
  ): void {
    if (numGlyphs === 0) {
      return;
    }

    const startQuad = this.sdfQuadCount;

    if (
      this.ensureSdfBufferCapacity(
        this.sdfBufferIdx + cachedVertices.length,
      ) === false
    ) {
      return;
    }

    // Single memcpy — much faster than per-glyph matrix math
    this.fSdfBuffer.set(cachedVertices, this.sdfBufferIdx);
    this.sdfBufferIdx += cachedVertices.length;
    this.sdfQuadCount += numGlyphs;

    this.finalizeSdfBatch(
      startQuad,
      numGlyphs,
      dx,
      dy,
      atlasTexture,
      clippingRect,
      worldAlpha,
      width,
      height,
      sdfShader,
    );
  }

  /**
   * Shared batching logic for SDF render ops.
   * Called by both `addSdfQuads` (full compute) and `addSdfCachedQuads` (fast copy).
   */
  private finalizeSdfBatch(
    startQuad: number,
    glyphCount: number,
    dx: number,
    dy: number,
    atlasTexture: WebGlCtxTexture,
    clippingRect: import('../../lib/utils.js').ClipRect,
    worldAlpha: number,
    width: number,
    height: number,
    sdfShader: WebGlShaderNode,
  ): void {
    // Every SDF write funnels through here, so this is the one place that sees
    // the frame's write order. Fold the batch size in so the upload skip can
    // tell "same bytes as last frame" from "same total, different layout".
    // Deltas stay out of the fold: they ride the ops, not the buffer bytes.
    this.sdfWriteSig = (this.sdfWriteSig * 31 + glyphCount) | 0;

    // --- Batching: try to extend the current SDF render op ---------------
    // One u_translate and one u_alpha apply to the whole draw call, so equal
    // deltas and equal world alpha are as load-bearing as the shared atlas
    // and scissor. Both are compared exactly: a last-ULP mismatch between
    // nodes moving or fading in lockstep splits the op (each half still
    // renders pixel-exact), whereas any tolerance would draw some node
    // visibly off its true position or opacity.
    const cur = this.curSdfRenderOp;
    if (
      cur !== null &&
      cur.renderOpTexture === (atlasTexture as unknown as WebGlCtxTexture) &&
      cur.translateX === dx &&
      cur.translateY === dy &&
      cur.worldAlpha === worldAlpha &&
      compareRect(cur.clippingRect, clippingRect) === true
    ) {
      // Extend existing op
      cur.numQuads += glyphCount;
      return;
    }

    const opList =
      RENDER_TEXT_BATCHING === true ? this.coreTextRenderOps : this.renderOps;

    // Take the next pooled SdfRenderOp (allocating only when the pool has
    // never been this deep) and reinitialize every field. init() assigns the
    // clippingRect by reference, preserving the aliasing the constructor-arg
    // version had.
    let op: SdfRenderOp;
    if (this.sdfOpPoolIdx < this.sdfOpPool.length) {
      op = this.sdfOpPool[this.sdfOpPoolIdx] as SdfRenderOp;
    } else {
      op = new SdfRenderOp(this);
      this.sdfOpPool.push(op);
    }
    this.sdfOpPoolIdx++;
    op.init(
      sdfShader,
      this.sdfQuadBufferCollection,
      atlasTexture as unknown as WebGlCtxTexture,
      worldAlpha,
      clippingRect,
      width,
      height,
      startQuad,
      glyphCount,
      dx,
      dy,
    );

    opList.push(op);
    this.curSdfRenderOp = op;

    // Break the regular quad render op chain so subsequent image/rect
    // nodes don't try to extend an SDF op.
    this.curRenderOp = null;
  }

  /**
   * Drop caches that are keyed to render-list order.
   *
   * @remarks
   * Called by the Stage when the render list is about to be rebuilt. A rebuild
   * can reorder text nodes without touching their SDF vertex caches;
   * byte-identical glyph data would then land at different offsets, so the
   * upload skip in {@link uploadSdfBuffer} must not fire on the rebuild frame.
   *
   * The quad buffer needs nothing here: it is rebuilt from scratch every frame.
   */
  override invalidateRenderListCaches(): void {
    this.sdfBufferChanged = true;
  }

  /**
   * Resizes the shared SDF ArrayBuffer if the required size (in floats) goes beyond
   * the current buffer capacity.
   *
   * @returns false when the request exceeds {@link MAX_SDF_BUFFER_SIZE}, in
   * which case the buffer is left untouched and the caller must skip its write
   * entirely — a partial write would desync `sdfBufferIdx` from the backing
   * store and throw on the next `set()` or upload.
   */
  private ensureSdfBufferCapacity(requiredSize: number): boolean {
    const currentSize = this.fSdfBuffer.length;
    if (requiredSize <= currentSize) {
      return true;
    }

    if (requiredSize > MAX_SDF_BUFFER_FLOATS) {
      return false;
    }

    let newCapacity = currentSize * 2;
    while (newCapacity < requiredSize) {
      newCapacity *= 2;
    }

    if (newCapacity > MAX_SDF_BUFFER_FLOATS) {
      newCapacity = MAX_SDF_BUFFER_FLOATS;
    }

    const sdfBufSize = newCapacity * Float32Array.BYTES_PER_ELEMENT;
    const newBuffer = new ArrayBuffer(sdfBufSize);
    const newFSdfBuffer = new Float32Array(newBuffer);
    const newUiSdfBuffer = new Uint32Array(newBuffer);

    // Copy existing data to new buffers
    newFSdfBuffer.set(this.fSdfBuffer);

    // Swap allocations
    this.sdfBuffer = newBuffer;
    this.fSdfBuffer = newFSdfBuffer;
    this.uiSdfBuffer = newUiSdfBuffer;

    // New backing store — never skip the next upload.
    this.sdfBufferChanged = true;

    return true;
  }

  /**
   * Bind a shader program, detaching the previously bound one.
   *
   * @remarks
   * This is GL context state, so it belongs to the renderer that owns the
   * context rather than to the backend-agnostic `CoreShaderManager` (Canvas2D
   * never had a use for it). Every `WebGlShaderProgram` implements both
   * `attach` and `detach`, so the optional-method probes the old
   * `CoreShaderProgram`-typed version needed are gone from this per-render-op
   * path.
   */
  useShader(program: WebGlShaderProgram): void {
    if (this.attachedShader === program) {
      return;
    }
    if (this.attachedShader !== null) {
      this.attachedShader.detach();
    }
    program.attach();
    this.attachedShader = program;
  }

  /**
   * Render the current set of RenderOps to render to the specified surface.
   *
   * The quad buffer is rebuilt on the CPU each frame by `addQuad` and uploaded
   * to the GPU in a single `bufferData` call.
   *
   * TODO: 'screen' is the only supported surface at the moment.
   *
   * @param surface
   */
  render(surface: 'screen' | CoreContextTexture = 'screen'): void {
    if (RENDER_TEXT_BATCHING === true) {
      this.flushTextRenderOps();
    }
    const { glw, quadBuffer } = this;
    const buffer = this.quadBufferCollection.getBuffer('a_position') || null;

    // The whole quad buffer is re-uploaded every frame, so DYNAMIC_DRAW is the
    // honest hint: STATIC_DRAW claims the data is written once and drawn many
    // times, and drivers act on that by choosing storage that is expensive to
    // rewrite. The hint describes update frequency, not whether the update is
    // partial.
    //
    // The view is cached rather than rebuilt per frame so that a steady scene
    // allocates nothing here.
    let arr = this.quadUploadView;
    if (arr === null || arr.length !== this.curBufferIdx) {
      arr = this.quadUploadView = new Float32Array(
        quadBuffer,
        0,
        this.curBufferIdx,
      );
    }
    glw.arrayBufferData(buffer, arr, glw.DYNAMIC_DRAW);

    // Upload the shared SDF buffer if any SDF glyphs were written this frame.
    this.uploadSdfBuffer();

    for (let i = 0, length = this.renderOps.length; i < length; i++) {
      this.renderOps[i]!.draw(this);
    }

    // curBufferIdx counts 32-bit words; 4 bytes each.
    this.quadBufferUsage = this.curBufferIdx * Float32Array.BYTES_PER_ELEMENT;
    this.numQuadsRendered = this.quadBufferUsage / BYTES_PER_QUAD;
  }

  /**
   * Upload the shared SDF buffer for the main pass, skipping the driver-side
   * `bufferData` copy when the bytes provably match what the GPU already
   * holds. All three must agree:
   *
   * 1. `sdfBufferChanged` is false — no write path produced fresh bytes, and
   *    no node snapped back to its cache base after a translated frame.
   * 2. The total size matches the last upload.
   * 3. The write fingerprint matches the last upload — same batches, same
   *    order, so byte-identical data landed at byte-identical offsets.
   *
   * (2) alone is not enough: a different set of text nodes can reach the same
   * total. Uncertainty resolves toward uploading — a redundant `bufferData`
   * costs a driver-side copy, a wrong skip leaves text drawn at a stale
   * position until some later frame happens to force an upload.
   */
  private uploadSdfBuffer(): void {
    if (this.sdfBufferIdx === 0) {
      // No text this frame. The GL buffer still holds the previous upload, so
      // drop the fingerprint: a later frame that writes the same size must not
      // read that as "the GPU already has these bytes".
      this.lastUploadedSdfSize = 0;
      this.lastUploadedSdfSig = 0;
      return;
    }
    if (
      this.sdfBufferChanged === false &&
      this.sdfBufferIdx === this.lastUploadedSdfSize &&
      this.sdfWriteSig === this.lastUploadedSdfSig
    ) {
      return;
    }
    const glw = this.glw;
    const sdfBuf = this.sdfQuadBufferCollection.getBuffer('a_position') || null;
    const sdfArr = new Float32Array(this.sdfBuffer, 0, this.sdfBufferIdx);
    glw.arrayBufferData(sdfBuf, sdfArr, glw.DYNAMIC_DRAW);
    this.lastUploadedSdfSize = this.sdfBufferIdx;
    this.lastUploadedSdfSig = this.sdfWriteSig;
    this.sdfBufferChanged = false;
  }

  getQuadCount(): number {
    return this.numQuadsRendered;
  }

  getRenderOpCount(): number {
    return this.renderOps.length;
  }

  getBufferInfo(): BufferInfo | null {
    const bufferInfo: BufferInfo = {
      totalAvailable: this.quadBufferSize,
      totalUsed: this.quadBufferUsage,
    };
    return bufferInfo;
  }

  getCapabilities(): RendererCapabilities {
    const glw = this.glw;
    return {
      renderMode: 'webgl',
      webGlVersion: glw.isWebGl2 ? 2 : 1,
      vertexArrayObject: glw.canUseVertexArrayObject,
      maxTextureSize: glw.getParameter(glw.MAX_TEXTURE_SIZE) as number,
      maxTextureUnits: glw.getParameter(glw.MAX_TEXTURE_IMAGE_UNITS) as number,
    };
  }

  /**
   * Drain the GL error queue once and report whether a GL_OUT_OF_MEMORY was
   * seen since the last call.
   *
   * @remarks
   * `gl.getError()` forces a CPU↔GPU sync, so this is deliberately invoked at
   * most once per frame by the Stage rather than after each texture upload.
   * `getError()` returns one error at a time, so we drain a bounded number of
   * queued errors to ensure a non-OOM error ahead of the OOM doesn't mask it
   * for this frame. Non-OOM errors are ignored here (the renderer otherwise
   * only inspects them in development builds).
   */
  override checkForOutOfMemory(): boolean {
    const glw = this.glw;
    let outOfMemory = false;
    for (let i = 0; i < MAX_DRAINED_GL_ERRORS; i++) {
      const error = glw.getError();
      if (error === 0) {
        break;
      }
      if (error === GL_OUT_OF_MEMORY) {
        outOfMemory = true;
      }
    }
    return outOfMemory;
  }

  getDefaultShaderNode(): WebGlShaderNode {
    if (this.defaultShaderNode !== null) {
      return this.defaultShaderNode as WebGlShaderNode;
    }
    this.stage.shManager.registerShaderType('default', Default);
    this.defaultShaderNode = this.stage.shManager.createShader(
      'default',
    ) as WebGlShaderNode;
    return this.defaultShaderNode;
  }

  override getTextureCoords(node: CoreNode): TextureCoords | undefined {
    const texture = node.texture;
    if (texture === null) {
      return undefined;
    }

    //this stuff needs to be properly moved to CtxSubTexture at some point in the future.
    const ctxTexture =
      (texture as SubTexture).parentTexture !== undefined
        ? (texture as SubTexture).parentTexture.ctxTexture
        : texture.ctxTexture;
    if (ctxTexture === undefined) {
      return undefined;
    }

    const textureOptions = node.props.textureOptions;

    //early exit for textures with no options unless its a subtexture
    if (
      texture.type !== TextureType.subTexture &&
      textureOptions === undefined
    ) {
      return (ctxTexture as WebGlCtxTexture).txCoords;
    }

    const base = (ctxTexture as WebGlCtxTexture).txCoords;
    const uv = resolveUvRect(
      node,
      texture,
      base.x1,
      base.y1,
      base.x2,
      base.y2,
      uvScratch,
    );
    return createTextureCoords(uv.x1, uv.y1, uv.x2, uv.y2);
  }

  /**
   * Sets the glClearColor to the specified color.   *
   * @param color - The color to set as the clear color, represented as a 32-bit integer.
   */
  updateClearColor(color: number) {
    if (this.clearColor.raw === color) {
      return;
    }
    const glw = this.glw;
    const normalizedColor = getNormalizedRgbaComponents(color);
    glw.clearColor(
      normalizedColor[0],
      normalizedColor[1],
      normalizedColor[2],
      normalizedColor[3],
    );
    this.clearColor = {
      raw: color,
      normalized: normalizedColor,
    };
  }
}
