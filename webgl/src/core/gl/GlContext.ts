import type { ContextSpy } from './contextSpy.js';

// WebGL 1.0 enums, fixed by the spec: literals rather than property reads
// on the context.
export const ARRAY_BUFFER = 0x8892;
export const ELEMENT_ARRAY_BUFFER = 0x8893;
export const STATIC_DRAW = 0x88e4;
export const DYNAMIC_DRAW = 0x88e8;
export const TEXTURE_2D = 0x0de1;
export const TRIANGLES = 0x0004;
export const UNSIGNED_BYTE = 0x1401;
export const UNSIGNED_SHORT = 0x1403;
export const FLOAT = 0x1406;
export const COLOR_BUFFER_BIT = 0x4000;
export const SCISSOR_TEST = 0x0c11;
export const BLEND = 0x0be2;
export const ONE = 1;
export const ONE_MINUS_SRC_ALPHA = 0x0303;
export const RGBA = 0x1908;
export const TEXTURE_MAG_FILTER = 0x2800;
export const TEXTURE_MIN_FILTER = 0x2801;
export const TEXTURE_WRAP_S = 0x2802;
export const TEXTURE_WRAP_T = 0x2803;
export const LINEAR = 0x2601;
export const LINEAR_MIPMAP_LINEAR = 0x2703;
export const CLAMP_TO_EDGE = 0x812f;
export const UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9241;
export const VERTEX_SHADER = 0x8b31;
export const FRAGMENT_SHADER = 0x8b30;
export const COMPILE_STATUS = 0x8b81;
export const LINK_STATUS = 0x8b82;
export const MAX_TEXTURE_SIZE = 0x0d33;
export const OUT_OF_MEMORY = 0x0505;
export const MAX_TEXTURE_IMAGE_UNITS = 0x8872;

/**
 * The kinds of a UniformTable entry, which uniformv uploads: float vectors
 * of 1 to 4 components, int vectors, and mat2 to mat4.
 */
export const K_F1 = 1;
export const K_F2 = 2;
export const K_F3 = 3;
export const K_F4 = 4;
export const K_I1 = 5;
export const K_I2 = 6;
export const K_I3 = 7;
export const K_I4 = 8;
export const K_M2 = 9;
export const K_M3 = 10;
export const K_M4 = 11;

/** A vertex array object: native on WebGL2, OES_vertex_array_object on WebGL1. */
export type Vao = WebGLVertexArrayObjectOES;

/**
 * The only code that touches the raw WebGL context (spec 7.1). It shadows
 * the bound program, VAO, texture and array buffer, the scissor test and
 * box, premultiplied uploads and the clear colour, so that a redundant bind
 * or state change costs no GL call: on the target TVs every call costs CPU.
 * The shadows start from a fresh context's known defaults rather than being
 * read back. Every texture binds on unit 0, the default active unit, so
 * activeTexture is never called.
 */
export class GlContext {
  /** A WebGL2 context used through the WebGL1 surface (forceWebGL2). */
  readonly isWebGl2: boolean;
  /** VAOs are available (WebGL2, or OES_vertex_array_object) and not disabled. */
  readonly canUseVao: boolean;
  private readonly gl: WebGLRenderingContext;
  private readonly vaoExt: OES_vertex_array_object | null;
  private program: WebGLProgram | null = null;
  private vao: Vao | null = null;
  private texture: WebGLTexture | null = null;
  private arrayBuffer: WebGLBuffer | null = null;
  private scissorOn = false;
  private sx = 0;
  private sy = 0;
  private sw: number;
  private sh: number;
  private premultiply = false;
  private clearRgba = 0;

  constructor(
    gl: WebGLRenderingContext,
    webgl2: boolean,
    disableVao: boolean,
    width: number,
    height: number,
  ) {
    this.gl = gl;
    this.isWebGl2 = webgl2;
    this.vaoExt =
      webgl2 === false && disableVao === false
        ? gl.getExtension('OES_vertex_array_object')
        : null;
    this.canUseVao =
      disableVao === false && (webgl2 === true || this.vaoExt !== null);
    // A fresh context's scissor box is the whole drawing buffer (GL spec),
    // which the browser can clamp smaller than the requested canvas size, so
    // the shadow seeds from the real drawing buffer, not width/height (1.10).
    this.sw = gl.drawingBufferWidth;
    this.sh = gl.drawingBufferHeight;
    gl.viewport(0, 0, width, height);
    // Premultiplied alpha throughout (spec 7.1), set once.
    gl.enable(BLEND);
    gl.blendFunc(ONE, ONE_MINUS_SRC_ALPHA);
  }

  resizeViewport(width: number, height: number): void {
    this.gl.viewport(0, 0, width, height);
    // A resized drawing buffer can reset the driver's scissor box.
    this.sw = -1;
    this.sh = -1;
  }

  useProgram(program: WebGLProgram): void {
    if (this.program !== program) {
      this.program = program;
      this.gl.useProgram(program);
    }
  }

  /** Bind a VAO, null for the default one. Only when canUseVao. */
  bindVao(vao: Vao | null): void {
    if (this.vao === vao) {
      return;
    }
    this.vao = vao;
    if (this.vaoExt !== null) {
      this.vaoExt.bindVertexArrayOES(vao);
    } else {
      (this.gl as unknown as WebGL2RenderingContext).bindVertexArray(
        vao as unknown as WebGLVertexArrayObject | null,
      );
    }
  }

  /** A new VAO, or null when allocation failed. Only when canUseVao. */
  createVao(): Vao | null {
    const vao: Vao | null =
      this.vaoExt !== null
        ? this.vaoExt.createVertexArrayOES()
        : ((
            this.gl as unknown as WebGL2RenderingContext
          ).createVertexArray() as unknown as Vao | null);
    return vao;
  }

  /** Point attribute `index` at `buffer`, recorded in the bound VAO. */
  attribPointer(
    buffer: WebGLBuffer,
    index: number,
    size: number,
    type: number,
    normalized: boolean,
    stride: number,
    offset: number,
  ): void {
    this.bindArrayBuffer(buffer);
    this.gl.vertexAttribPointer(index, size, type, normalized, stride, offset);
  }

  /**
   * Enable the arrays in `mask` in the bound VAO, whose arrays are all
   * disabled: a fresh VAO, or a fresh context's default one.
   */
  enableAttribs(mask: number): void {
    for (let i = 0; mask >>> i !== 0; i++) {
      if (((mask >>> i) & 1) === 1) {
        this.gl.enableVertexAttribArray(i);
      }
    }
  }

  /** Record the index buffer in the bound VAO: the element binding is VAO state. */
  bindIndexBuffer(buffer: WebGLBuffer): void {
    this.gl.bindBuffer(ELEMENT_ARRAY_BUFFER, buffer);
  }

  createBuffer(): WebGLBuffer {
    return this.gl.createBuffer();
  }

  /** A buffer filled once (STATIC_DRAW). */
  staticBuffer(target: number, data: ArrayBufferView): WebGLBuffer {
    const buffer = this.createBuffer();
    if (target === ARRAY_BUFFER) {
      this.bindArrayBuffer(buffer);
    } else {
      this.gl.bindBuffer(target, buffer);
    }
    this.gl.bufferData(target, data, STATIC_DRAW);
    return buffer;
  }

  /** Re-specify `buffer` from `data` (DYNAMIC_DRAW): one call per chunk. */
  uploadVertices(buffer: WebGLBuffer, data: Float32Array): void {
    this.bindArrayBuffer(buffer);
    this.gl.bufferData(ARRAY_BUFFER, data, DYNAMIC_DRAW);
  }

  bindTexture(texture: WebGLTexture | null): void {
    if (this.texture !== texture) {
      this.texture = texture;
      this.gl.bindTexture(TEXTURE_2D, texture);
    }
  }

  /**
   * A texture with `minFilter` and CLAMP_TO_EDGE wrapping: LINEAR is
   * NPOT-safe, with no mipmaps (1.10); LINEAR_MIPMAP_LINEAR is for a
   * compressed texture that carries its whole chain of levels. Mag
   * filtering is left at the GL default, which is already LINEAR, so
   * setting it would be a wasted call on every texture.
   */
  createTexture(minFilter: number): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    this.bindTexture(texture);
    gl.texParameteri(TEXTURE_2D, TEXTURE_MIN_FILTER, minFilter);
    gl.texParameteri(TEXTURE_2D, TEXTURE_WRAP_S, CLAMP_TO_EDGE);
    gl.texParameteri(TEXTURE_2D, TEXTURE_WRAP_T, CLAMP_TO_EDGE);
    return texture;
  }

  /**
   * Upload `source` into `texture`: an image-like source, or `w` x `h` RGBA
   * bytes. `premultiply` asks WebGL to premultiply straight-alpha pixels.
   */
  texImage(
    texture: WebGLTexture,
    source: TexImageSource | ArrayBufferView,
    w: number,
    h: number,
    premultiply: boolean,
  ): void {
    const gl = this.gl;
    this.bindTexture(texture);
    if (this.premultiply !== premultiply) {
      this.premultiply = premultiply;
      gl.pixelStorei(UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    }
    if (ArrayBuffer.isView(source) === true) {
      gl.texImage2D(
        TEXTURE_2D,
        0,
        RGBA,
        w,
        h,
        0,
        RGBA,
        UNSIGNED_BYTE,
        source as ArrayBufferView,
      );
    } else {
      gl.texImage2D(
        TEXTURE_2D,
        0,
        RGBA,
        RGBA,
        UNSIGNED_BYTE,
        source as TexImageSource,
      );
    }
  }

  /**
   * Allocate `w` x `h` RGBA texels in `texture`, with no pixels: WebGL
   * zero-fills them, so an atlas page starts transparent.
   */
  texStorage(texture: WebGLTexture, w: number, h: number): void {
    this.bindTexture(texture);
    this.gl.texImage2D(TEXTURE_2D, 0, RGBA, w, h, 0, RGBA, UNSIGNED_BYTE, null);
  }

  /**
   * Upload `source` into the region of `texture` at `x`, `y`: an image-like
   * source, or `w` x `h` RGBA bytes. `premultiply` as for texImage.
   */
  texSubImage(
    texture: WebGLTexture,
    x: number,
    y: number,
    source: TexImageSource | ArrayBufferView,
    w: number,
    h: number,
    premultiply: boolean,
  ): void {
    const gl = this.gl;
    this.bindTexture(texture);
    if (this.premultiply !== premultiply) {
      this.premultiply = premultiply;
      gl.pixelStorei(UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    }
    if (ArrayBuffer.isView(source) === true) {
      gl.texSubImage2D(
        TEXTURE_2D,
        0,
        x,
        y,
        w,
        h,
        RGBA,
        UNSIGNED_BYTE,
        source as ArrayBufferView,
      );
    } else {
      gl.texSubImage2D(
        TEXTURE_2D,
        0,
        x,
        y,
        RGBA,
        UNSIGNED_BYTE,
        source as TexImageSource,
      );
    }
  }

  /** gl.getExtension: for compressed formats, enabling one is getting it. */
  extension(name: string): object | null {
    return this.gl.getExtension(name) as object | null;
  }

  /** One compressed mip level into `texture` (compressed.ts). */
  compressedTexImage(
    texture: WebGLTexture,
    level: number,
    format: number,
    w: number,
    h: number,
    data: ArrayBufferView,
  ): void {
    this.bindTexture(texture);
    this.gl.compressedTexImage2D(TEXTURE_2D, level, format, w, h, 0, data);
  }

  /** Deleting the bound texture unbinds it in GL, and here. */
  deleteTexture(texture: WebGLTexture): void {
    if (this.texture === texture) {
      this.texture = null;
    }
    this.gl.deleteTexture(texture);
  }

  /**
   * Compile and link a program with `attributes[i]` bound to location i, so
   * that every program shares one vertex layout. Checks LINK_STATUS only:
   * `getShaderParameter(COMPILE_STATUS)` per shader is a second blocking
   * round trip to Chrome's GPU process for every shader, and shaders compile
   * on first use (mid-frame on TVs), so a failed compile is left to fail the
   * link instead. On failure the error carries the program log plus both
   * shaders' logs, since a compile error's own text lives in the shader's
   * log, not the program's.
   */
  compile(
    vertex: string,
    fragment: string,
    attributes: string[],
  ): WebGLProgram {
    const gl = this.gl;
    const program = gl.createProgram();
    const vertexShader = this.shader(VERTEX_SHADER, vertex);
    const fragmentShader = this.shader(FRAGMENT_SHADER, fragment);
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    for (let i = 0; i < attributes.length; i++) {
      gl.bindAttribLocation(program, i, attributes[i]!);
    }
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, LINK_STATUS) !== true) {
      throw new Error(
        `Program link failed: ${gl.getProgramInfoLog(program)}\n` +
          `Vertex shader: ${gl.getShaderInfoLog(vertexShader)}\n` +
          `Fragment shader: ${gl.getShaderInfoLog(fragmentShader)}`,
      );
    }
    return program;
  }

  uniformLocation(
    program: WebGLProgram,
    name: string,
  ): WebGLUniformLocation | null {
    return this.gl.getUniformLocation(program, name);
  }

  uniform4fv(location: WebGLUniformLocation | null, value: Float32Array): void {
    this.gl.uniform4fv(location, value);
  }

  uniform1f(location: WebGLUniformLocation, x: number): void {
    this.gl.uniform1f(location, x);
  }

  uniform2f(location: WebGLUniformLocation, x: number, y: number): void {
    this.gl.uniform2f(location, x, y);
  }

  uniform4f(
    location: WebGLUniformLocation,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    this.gl.uniform4f(location, x, y, z, w);
  }

  /**
   * A UniformTable entry: `kind` is one of the K_* kinds above; one it does
   * not know uploads nothing.
   */
  uniformv(
    kind: number,
    location: WebGLUniformLocation,
    data: Float32Array | Int32Array,
  ): void {
    const gl = this.gl;
    switch (kind) {
      case K_F1:
        gl.uniform1fv(location, data as Float32Array);
        break;
      case K_F2:
        gl.uniform2fv(location, data as Float32Array);
        break;
      case K_F3:
        gl.uniform3fv(location, data as Float32Array);
        break;
      case K_F4:
        gl.uniform4fv(location, data as Float32Array);
        break;
      case K_I1:
        gl.uniform1iv(location, data as Int32Array);
        break;
      case K_I2:
        gl.uniform2iv(location, data as Int32Array);
        break;
      case K_I3:
        gl.uniform3iv(location, data as Int32Array);
        break;
      case K_I4:
        gl.uniform4iv(location, data as Int32Array);
        break;
      case K_M2:
        gl.uniformMatrix2fv(location, false, data as Float32Array);
        break;
      case K_M3:
        gl.uniformMatrix3fv(location, false, data as Float32Array);
        break;
      case K_M4:
        gl.uniformMatrix4fv(location, false, data as Float32Array);
        break;
    }
  }

  /** The context is lost: every call is a no-op and every query answers null. */
  isLost(): boolean {
    return this.gl.isContextLost();
  }

  scissorTest(on: boolean): void {
    if (this.scissorOn === on) {
      return;
    }
    this.scissorOn = on;
    if (on === true) {
      this.gl.enable(SCISSOR_TEST);
    } else {
      this.gl.disable(SCISSOR_TEST);
    }
  }

  scissor(x: number, y: number, w: number, h: number): void {
    if (x !== this.sx || y !== this.sy || w !== this.sw || h !== this.sh) {
      this.sx = x;
      this.sy = y;
      this.sw = w;
      this.sh = h;
      this.gl.scissor(x, y, w, h);
    }
  }

  /** The clear colour, 0xRRGGBBAA, uploaded straight (not premultiplied), as in 1.10. */
  clearColor(rgba: number): void {
    const v = rgba >>> 0;
    if (v === this.clearRgba) {
      return;
    }
    this.clearRgba = v;
    this.gl.clearColor(
      (v >>> 24) / 255,
      ((v >>> 16) & 0xff) / 255,
      ((v >>> 8) & 0xff) / 255,
      (v & 0xff) / 255,
    );
  }

  clear(): void {
    this.gl.clear(COLOR_BUFFER_BIT);
  }

  /** Draw `count` quads from quad `start` (six Uint16 indices per quad). */
  drawQuads(start: number, count: number): void {
    this.gl.drawElements(TRIANGLES, count * 6, UNSIGNED_SHORT, start * 12);
  }

  parameter(name: number): number {
    return this.gl.getParameter(name) as number;
  }

  /**
   * Drain the GL error queue; true when it held GL_OUT_OF_MEMORY. Errors
   * persist until drained, so one drain on going idle catches any raised
   * while drawing. Never call it in the frame loop: getError() stalls for
   * the GPU (spec 12.1). Bounded, since a lost context keeps answering.
   */
  outOfMemory(): boolean {
    const gl = this.gl;
    let oom = false;
    for (let i = 0; i < 8; i++) {
      const error = gl.getError();
      if (error === 0) {
        break;
      }
      if (error === OUT_OF_MEMORY) {
        oom = true;
      }
    }
    return oom;
  }

  /** Release every GL object at once by losing the context (destroy). */
  lose(): void {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    if (ext !== null) {
      ext.loseContext();
    }
  }

  private bindArrayBuffer(buffer: WebGLBuffer): void {
    if (this.arrayBuffer !== buffer) {
      this.arrayBuffer = buffer;
      this.gl.bindBuffer(ARRAY_BUFFER, buffer);
    }
  }

  /** Compile `source`; a failure surfaces through the caller's LINK_STATUS check. */
  private shader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type) as WebGLShader;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  }
}

/**
 * Create the context with the 1.10 attributes (spec 7.1): no antialias (SDF
 * edges do their own), no depth or stencil buffer, premultiplied alpha, no
 * preserved drawing buffer. `forceWebGL2` asks for WebGL2 and uses it
 * through the WebGL1 surface; `experimental-webgl` is the last resort. The
 * spy, when given, wraps the raw context before anything uses it. The
 * canvas is already sized.
 */
export function createGlContext(
  canvas: HTMLCanvasElement,
  forceWebGL2: boolean,
  powerPreference: WebGLPowerPreference,
  disableVao: boolean,
  spy: ContextSpy | null,
): GlContext {
  const attributes: WebGLContextAttributes = {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    desynchronized: false,
    powerPreference,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  };
  let gl = canvas.getContext(
    forceWebGL2 === true ? 'webgl2' : 'webgl',
    attributes,
  ) as WebGLRenderingContext | null;
  if (gl === null) {
    gl = canvas.getContext(
      'experimental-webgl',
      attributes,
    ) as WebGLRenderingContext | null;
  }
  if (gl === null) {
    throw new Error('Unable to create WebGL context');
  }
  // A canvas keeps its context for life: one that was lost (a destroyed
  // Renderer's canvas) hands the lost context out again, and every call on
  // it then fails quietly, first as "Program link failed: null".
  if (gl.isContextLost() === true) {
    throw new Error(
      'WebGL context is lost: a canvas whose context was lost cannot host a new Renderer, use a fresh canvas',
    );
  }
  // Duck-typed: WebGL2RenderingContext does not exist on the Chrome 38 floor.
  const webgl2 =
    typeof (gl as unknown as WebGL2RenderingContext).createVertexArray ===
    'function';
  if (spy !== null) {
    gl = spy.wrap(gl);
  }
  return new GlContext(gl, webgl2, disableVao, canvas.width, canvas.height);
}
