/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/**
 * Optimized WebGL Context Wrapper
 *
 * @remarks
 * This class contains the subset of the WebGLRenderingContext &
 * WebGL2RenderingContext API that is used by the renderer. Select high volume
 * WebGL methods include
 * caching optimizations to avoid making WebGL calls if the state is already set
 * to the desired value.
 *
 * While most methods contained are direct passthroughs to the WebGL context,
 * some methods combine multiple WebGL calls into one for convenience, modify
 * arguments to be more convenient, or are replaced by more specific methods.
 *
 * Not all methods are optimized. Only methods that are called frequently
 * and/or have a high cost are optimized.
 *
 * A subset of GLenum constants are also exposed as properties on this class
 * for convenience.
 */
export class WebGlContextWrapper {
  //#region Cached WebGL State
  private activeTextureUnit = 0;
  /**
   * TEXTURE_2D binding on the active unit. Every caller uses unit 0, so one
   * slot replaces a per-unit table; switching units resets it to `undefined`
   * (unknown), which forces the next bind through.
   */
  private boundTexture: WebGLTexture | null | undefined = null;
  private texture2dParams: WeakMap<
    WebGLTexture,
    Record<number, number | undefined>
  > = new WeakMap();
  private scissorEnabled;
  private scissorX: number;
  private scissorY: number;
  private scissorWidth: number;
  private scissorHeight: number;
  private boundArrayBuffer: WebGLBuffer | null;
  private boundElementArrayBuffer: WebGLBuffer | null;
  private curProgram: WebGLProgram | null;
  private curUniformLocations: Record<string, WebGLUniformLocation> = {};
  //#endregion Cached WebGL State

  //#region Vertex Array Objects
  // Native VAO handle when running on WebGL2, otherwise null.
  private gl2: WebGL2RenderingContext | null;
  /**
   * Currently bound Vertex Array Object (`null` is the default VAO).
   *
   * Every quad render op re-binds the same object: all CoreNode ops share the
   * renderer's `quadBufferCollection`, so a program's VAO cache hands back one
   * VAO for the whole frame. Without this shadow that is one GL call per op,
   * out of the three a plain image op costs.
   */
  private boundVertexArray: WebGLVertexArrayObject | null = null;
  // OES_vertex_array_object handle when running on WebGL1 with the extension,
  // otherwise null.
  private vaoExt: OES_vertex_array_object | null;
  /**
   * True when Vertex Array Objects are available (native WebGL2 or the
   * `OES_vertex_array_object` WebGL1 extension). Lets callers cache attribute
   * layout in a VAO and bind it with a single call instead of re-pointing
   * every attribute on each draw.
   */
  public readonly canUseVertexArrayObject: boolean;
  /** True when the underlying context is a WebGL2RenderingContext. */
  public readonly isWebGl2: boolean;
  //#endregion Vertex Array Objects

  //#region Canvas
  public readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  /**
   * Cached copies of `canvas.width`/`canvas.height`.
   *
   * @remarks
   * On HTMLCanvasElement these are DOM getters that cross into Blink — too
   * slow to read per render op per frame on embedded targets. The canvas is
   * sized once, before the renderer is created, and never resized after.
   */
  public readonly canvasW: number;
  public readonly canvasH: number;
  //#endregion Canvas

  //#region WebGL Enums
  public readonly MAX_RENDERBUFFER_SIZE;
  public readonly MAX_TEXTURE_SIZE;
  public readonly MAX_VIEWPORT_DIMS;
  public readonly MAX_VERTEX_TEXTURE_IMAGE_UNITS;
  public readonly MAX_TEXTURE_IMAGE_UNITS;
  public readonly MAX_COMBINED_TEXTURE_IMAGE_UNITS;
  public readonly MAX_VERTEX_ATTRIBS;
  public readonly MAX_VARYING_VECTORS;
  public readonly MAX_VERTEX_UNIFORM_VECTORS;
  public readonly MAX_FRAGMENT_UNIFORM_VECTORS;
  public readonly TEXTURE_MAG_FILTER;
  public readonly TEXTURE_MIN_FILTER;
  public readonly TEXTURE_WRAP_S;
  public readonly TEXTURE_WRAP_T;
  public readonly LINEAR;
  public readonly LINEAR_MIPMAP_LINEAR;
  public readonly CLAMP_TO_EDGE;
  public readonly RGB;
  public readonly RGBA;
  public readonly UNSIGNED_BYTE;
  public readonly UNPACK_PREMULTIPLY_ALPHA_WEBGL;
  public readonly UNPACK_FLIP_Y_WEBGL;
  public readonly FLOAT;
  public readonly TRIANGLES;
  public readonly UNSIGNED_SHORT;
  public readonly ONE;
  public readonly ONE_MINUS_SRC_ALPHA;
  public readonly VERTEX_SHADER;
  public readonly FRAGMENT_SHADER;
  public readonly STATIC_DRAW;
  public readonly COMPILE_STATUS;
  public readonly LINK_STATUS;
  public readonly DYNAMIC_DRAW;
  public readonly INVALID_ENUM: number;
  public readonly INVALID_OPERATION: number;
  //#endregion WebGL Enums

  constructor(
    private gl: WebGLRenderingContext | WebGL2RenderingContext,
    disableVertexArrayObject = false,
  ) {
    // A freshly created WebGL context is in a fully specified default state.
    // Rather than reading that state back with getParameter/isEnabled — each a
    // synchronous CPU<->GPU round-trip, and previously ~one per texture unit
    // (16-32) just to enumerate the bindings — we seed the cache with those
    // known defaults. The engine never restores a lost context in place (it
    // reloads the app on `contextLost`), so there is no live state to recover.
    this.activeTextureUnit = 0;
    // Texture units start unbound (TEXTURE_BINDING_2D === null).
    this.boundTexture = null;

    // SCISSOR_TEST disabled; SCISSOR_BOX defaults to the full drawing buffer.
    this.scissorEnabled = false;
    this.scissorX = 0;
    this.scissorY = 0;
    this.scissorWidth = gl.drawingBufferWidth;
    this.scissorHeight = gl.drawingBufferHeight;

    // No buffers or program bound on a fresh context.
    this.boundArrayBuffer = null;
    this.boundElementArrayBuffer = null;
    this.curProgram = null;

    // Resolve Vertex Array Object support: native on WebGL2, otherwise the
    // OES_vertex_array_object extension on WebGL1 (universally available on
    // the target browsers). `self` is used over `window` so the check also
    // works when the context lives on an OffscreenCanvas in a worker.
    this.gl2 =
      self.WebGL2RenderingContext && gl instanceof self.WebGL2RenderingContext
        ? (gl as WebGL2RenderingContext)
        : null;
    // `disableVertexArrayObject` forces the per-draw attribute-binding path even
    // when VAOs are available (diagnostics / benchmarking). isWebGl2 still
    // reflects the real context — the flag only gates VAO usage.
    this.vaoExt =
      this.gl2 === null && disableVertexArrayObject !== true
        ? gl.getExtension('OES_vertex_array_object')
        : null;
    this.canUseVertexArrayObject =
      disableVertexArrayObject !== true &&
      (this.gl2 !== null || this.vaoExt !== null);
    this.isWebGl2 = this.gl2 !== null;

    this.canvas = gl.canvas;
    this.canvasW = gl.canvas.width;
    this.canvasH = gl.canvas.height;

    // Extract GLenums
    this.MAX_RENDERBUFFER_SIZE = gl.MAX_RENDERBUFFER_SIZE;
    this.MAX_TEXTURE_SIZE = gl.MAX_TEXTURE_SIZE;
    this.MAX_VIEWPORT_DIMS = gl.MAX_VIEWPORT_DIMS;
    this.MAX_VERTEX_TEXTURE_IMAGE_UNITS = gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS;
    this.MAX_TEXTURE_IMAGE_UNITS = gl.MAX_TEXTURE_IMAGE_UNITS;
    this.MAX_COMBINED_TEXTURE_IMAGE_UNITS = gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS;
    this.MAX_VERTEX_ATTRIBS = gl.MAX_VERTEX_ATTRIBS;
    this.MAX_VARYING_VECTORS = gl.MAX_VARYING_VECTORS;
    this.MAX_VERTEX_UNIFORM_VECTORS = gl.MAX_VERTEX_UNIFORM_VECTORS;
    this.MAX_FRAGMENT_UNIFORM_VECTORS = gl.MAX_FRAGMENT_UNIFORM_VECTORS;
    this.TEXTURE_MAG_FILTER = gl.TEXTURE_MAG_FILTER;
    this.TEXTURE_MIN_FILTER = gl.TEXTURE_MIN_FILTER;
    this.TEXTURE_WRAP_S = gl.TEXTURE_WRAP_S;
    this.TEXTURE_WRAP_T = gl.TEXTURE_WRAP_T;
    this.LINEAR = gl.LINEAR;
    this.LINEAR_MIPMAP_LINEAR = gl.LINEAR_MIPMAP_LINEAR;
    this.CLAMP_TO_EDGE = gl.CLAMP_TO_EDGE;
    this.RGB = gl.RGB;
    this.RGBA = gl.RGBA;
    this.UNSIGNED_BYTE = gl.UNSIGNED_BYTE;
    this.UNPACK_PREMULTIPLY_ALPHA_WEBGL = gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL;
    this.UNPACK_FLIP_Y_WEBGL = gl.UNPACK_FLIP_Y_WEBGL;
    this.FLOAT = gl.FLOAT;
    this.TRIANGLES = gl.TRIANGLES;
    this.UNSIGNED_SHORT = gl.UNSIGNED_SHORT;
    this.ONE = gl.ONE;
    this.ONE_MINUS_SRC_ALPHA = gl.ONE_MINUS_SRC_ALPHA;
    this.VERTEX_SHADER = gl.VERTEX_SHADER;
    this.FRAGMENT_SHADER = gl.FRAGMENT_SHADER;
    this.STATIC_DRAW = gl.STATIC_DRAW;
    this.COMPILE_STATUS = gl.COMPILE_STATUS;
    this.LINK_STATUS = gl.LINK_STATUS;
    this.DYNAMIC_DRAW = gl.DYNAMIC_DRAW;
    this.INVALID_ENUM = gl.INVALID_ENUM;
    this.INVALID_OPERATION = gl.INVALID_OPERATION;
  }
  /**
   * ```
   * gl.activeTexture(textureUnit + gl.TEXTURE0);
   * ```
   *
   * @remarks
   * **WebGL Difference**: `textureUnit` is based from 0, not `gl.TEXTURE0`.
   *
   * @param textureUnit
   */
  activeTexture(textureUnit: number) {
    if (this.activeTextureUnit !== textureUnit) {
      this.gl.activeTexture(textureUnit + this.gl.TEXTURE0);
      this.activeTextureUnit = textureUnit;
      this.boundTexture = undefined;
    }
  }

  /**
   * ```
   * gl.bindTexture(gl.TEXTURE_2D, texture);
   * ```
   * @remarks
   * **WebGL Difference**: Bind target is always `gl.TEXTURE_2D`
   *
   * @param texture
   */
  bindTexture(texture: WebGLTexture | null) {
    if (this.boundTexture === texture) {
      return;
    }
    this.boundTexture = texture;

    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
  }

  private _getActiveTexture(): WebGLTexture | null {
    return this.boundTexture === undefined ? null : this.boundTexture;
  }

  /**
   * ```
   * gl.texParameteri(gl.TEXTURE_2D, pname, param);
   * ```
   * @remarks
   * **WebGL Difference**: Bind target is always `gl.TEXTURE_2D`
   *
   * @param pname
   * @param param
   * @returns
   */
  texParameteri(pname: number, param: number) {
    const activeTexture = this._getActiveTexture();
    if (!activeTexture) {
      throw new Error('No active texture');
    }
    let textureParams = this.texture2dParams.get(activeTexture);
    if (!textureParams) {
      textureParams = {};
      this.texture2dParams.set(activeTexture, textureParams);
    }
    if (textureParams[pname] === param) {
      return;
    }
    textureParams[pname] = param;
    this.gl.texParameteri(this.gl.TEXTURE_2D, pname, param);
  }

  /**
   * ```
   * gl.texImage2D(
   *   gl.TEXTURE_2D,
   *   level,
   *   internalFormat,
   *   width,
   *   height,
   *   border,
   *   format,
   *   type,
   *   pixels,
   * );
   * ```
   * @remarks
   * **WebGL Difference**: Bind target is always `gl.TEXTURE_2D`
   *
   * @param level
   * @param internalFormat
   * @param width
   * @param height
   * @param border
   * @param format
   * @param type
   * @param pixels
   */
  texImage2D(
    level: GLint,
    internalformat: GLint,
    width: GLsizei,
    height: GLsizei,
    border: GLint,
    format: GLenum,
    type: GLenum,
    pixels: ArrayBufferView | null,
  ): void;
  texImage2D(
    level: GLint,
    internalformat: GLint,
    format: GLenum,
    type: GLenum,
    source: TexImageSource | Uint8Array,
  ): void;
  texImage2D(
    level: any,
    internalFormat: any,
    widthOrFormat: any,
    heightOrType: any,
    borderOrSource: any,
    format?: any,
    type?: any,
    pixels?: any,
  ) {
    if (format) {
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        level,
        internalFormat,
        widthOrFormat,
        heightOrType,
        borderOrSource,
        format,
        type,
        pixels,
      );
    } else {
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        level,
        internalFormat,
        widthOrFormat,
        heightOrType,
        borderOrSource,
      );
    }
  }
  /**
   * ```
   * gl.compressedTexImage2D(gl.TEXTURE_2D, level, internalFormat, width, height, border, data);
   * ```
   *
   * @remarks
   * **WebGL Difference**: Bind target is always `gl.TEXTURE_2D`
   */

  compressedTexImage2D(
    level: GLint,
    internalformat: GLenum,
    width: GLsizei,
    height: GLsizei,
    border: GLint,
    data?: ArrayBufferView,
  ): void {
    this.gl.compressedTexImage2D(
      this.gl.TEXTURE_2D,
      level,
      internalformat,
      width,
      height,
      border,
      data as ArrayBufferView,
    );
  }
  /**
   * ```
   * gl.pixelStorei(pname, param);
   * ```
   *
   * @param pname
   * @param param
   */
  pixelStorei(pname: GLenum, param: GLint | GLboolean) {
    this.gl.pixelStorei(pname, param);
  }

  /**
   * ```
   * gl.createTexture();
   * ```
   *
   * @returns
   */
  createTexture() {
    return this.gl.createTexture();
  }

  /**
   * ```
   * gl.deleteTexture(texture);
   * ```
   *
   * @param texture
   */
  deleteTexture(texture: WebGLTexture | null) {
    if (texture) {
      this.texture2dParams.delete(texture);
    }
    this.gl.deleteTexture(texture);
  }

  /**
   * ```
   * gl.viewport(x, y, width, height);
   * ```
   */
  viewport(x: GLint, y: GLint, width: GLsizei, height: GLsizei) {
    this.gl.viewport(x, y, width, height);
  }

  /**
   * ```
   * gl.clearColor(red, green, blue, alpha);
   * ```
   *
   * @param red
   * @param green
   * @param blue
   * @param alpha
   */
  clearColor(red: GLclampf, green: GLclampf, blue: GLclampf, alpha: GLclampf) {
    this.gl.clearColor(red, green, blue, alpha);
  }

  /**
   * ```
   * gl["enable"|"disable"](gl.SCISSOR_TEST);
   * ```
   * @param enable
   */
  setScissorTest(enable: boolean) {
    if (enable === this.scissorEnabled) {
      return;
    }
    if (enable) {
      this.gl.enable(this.gl.SCISSOR_TEST);
    } else {
      this.gl.disable(this.gl.SCISSOR_TEST);
    }
    this.scissorEnabled = enable;
  }

  /**
   * ```
   * gl.scissor(x, y, width, height);
   * ```
   *
   * @param x
   * @param y
   * @param width
   * @param height
   */
  scissor(x: GLint, y: GLint, width: GLsizei, height: GLsizei) {
    if (
      x !== this.scissorX ||
      y !== this.scissorY ||
      width !== this.scissorWidth ||
      height !== this.scissorHeight
    ) {
      this.gl.scissor(x, y, width, height);
      this.scissorX = x;
      this.scissorY = y;
      this.scissorWidth = width;
      this.scissorHeight = height;
    }
  }

  /**
   * ```
   * gl["enable"|"disable"](gl.BLEND);
   * ```
   *
   * @remarks
   * Not cached: blending is configured once at renderer init and never
   * toggled per draw.
   *
   * @param blend
   */
  setBlend(blend: boolean) {
    if (blend === true) {
      this.gl.enable(this.gl.BLEND);
    } else {
      this.gl.disable(this.gl.BLEND);
    }
  }

  /**
   * ```
   * gl.blendFunc(src, dst);
   * ```
   *
   * @param src
   * @param dst
   */
  blendFunc(src: GLenum, dst: GLenum) {
    this.gl.blendFunc(src, dst);
  }

  /**
   * ```
   * gl.createBuffer();
   * ```
   *
   * @returns
   */
  createBuffer() {
    return this.gl.createBuffer();
  }

  /**
   * ```
   * gl.clear(gl.COLOR_BUFFER_BIT);
   * ```
   *
   * @remarks
   * **WebGL Difference**: Clear mask is always `gl.COLOR_BUFFER_BIT`
   */
  clear() {
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  /**
   * ```
   * gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
   * gl.bufferData(gl.ARRAY_BUFFER, data, usage);
   * ```
   *
   * @remarks
   * **WebGL Combo**: `gl.bindBuffer` and `gl.bufferData` are combined into one function.
   *
   * @param buffer
   * @param data
   * @param usage
   */
  arrayBufferData(
    buffer: WebGLBuffer | null,
    data: ArrayBufferView,
    usage: GLenum,
  ) {
    if (this.boundArrayBuffer !== buffer) {
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
      this.boundArrayBuffer = buffer;
    }
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, usage);
  }

  /**
   * ```
   * gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
   * gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, usage);
   * ```
   * @remarks
   * **WebGL Combo**: `gl.bindBuffer` and `gl.bufferData` are combined into one function.
   *
   * @param buffer
   * @param data
   * @param usage
   */
  elementArrayBufferData(
    buffer: WebGLBuffer | null,
    data: ArrayBufferView,
    usage: GLenum,
  ) {
    if (this.boundElementArrayBuffer !== buffer) {
      this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, buffer);
      this.boundElementArrayBuffer = buffer;
    }
    this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, data, usage);
  }

  /**
   * ```
   * gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
   * gl.vertexAttribPointer(index, size, type, normalized, stride, offset);
   * ```
   *
   * @remarks
   * **WebGL Combo**: `gl.bindBuffer` and `gl.vertexAttribPointer` are combined into one function.
   *
   * @param buffer
   * @param index
   * @param size
   * @param type
   * @param normalized
   * @param stride
   * @param offset
   */
  vertexAttribPointer(
    buffer: WebGLBuffer,
    index: GLuint,
    size: GLint,
    type: GLenum,
    normalized: GLboolean,
    stride: GLsizei,
    offset: GLintptr,
  ) {
    if (this.boundArrayBuffer !== buffer) {
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
      this.boundArrayBuffer = buffer;
    }
    this.gl.vertexAttribPointer(index, size, type, normalized, stride, offset);
  }

  /**
   * ```
   * gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
   * ```
   *
   * @remarks
   * Binds an element (index) array buffer WITHOUT the upload that
   * {@link elementArrayBufferData} performs, and WITHOUT the binding-cache
   * short-circuit. The element-array binding is part of Vertex Array Object
   * state, so this is used while building a VAO to record the shared index
   * buffer into it. The bind is unconditional because binding a VAO already
   * changes the element-array binding out from under the cache.
   *
   * @param buffer
   */
  bindElementArrayBuffer(buffer: WebGLBuffer | null) {
    this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, buffer);
    this.boundElementArrayBuffer = buffer;
  }

  /**
   * Creates a Vertex Array Object.
   *
   * @remarks
   * Backed by native WebGL2 or the `OES_vertex_array_object` extension. Returns
   * `null` when neither is available; guard with {@link canUseVertexArrayObject}.
   *
   * @returns
   */
  createVertexArray(): WebGLVertexArrayObject | null {
    if (this.gl2 !== null) {
      return this.gl2.createVertexArray();
    }
    if (this.vaoExt !== null) {
      return this.vaoExt.createVertexArrayOES();
    }
    return null;
  }

  /**
   * Binds a Vertex Array Object (or `null` to bind the default VAO).
   *
   * @param vertexArray
   */
  bindVertexArray(vertexArray: WebGLVertexArrayObject | null) {
    if (this.boundVertexArray === vertexArray) {
      return;
    }
    if (this.gl2 !== null) {
      this.gl2.bindVertexArray(vertexArray);
      this.boundVertexArray = vertexArray;
      return;
    }
    if (this.vaoExt !== null) {
      this.vaoExt.bindVertexArrayOES(vertexArray);
      this.boundVertexArray = vertexArray;
    }
  }

  /**
   * Deletes a Vertex Array Object.
   *
   * @param vertexArray
   */
  deleteVertexArray(vertexArray: WebGLVertexArrayObject) {
    // Deleting the bound VAO implicitly rebinds the default one, so the shadow
    // has to follow or the next bind of the default VAO would be skipped.
    if (this.boundVertexArray === vertexArray) {
      this.boundVertexArray = null;
    }
    if (this.gl2 !== null) {
      this.gl2.deleteVertexArray(vertexArray);
      return;
    }
    if (this.vaoExt !== null) {
      this.vaoExt.deleteVertexArrayOES(vertexArray);
    }
  }

  /**
   * Returns object with Attribute names as key and numbers as location values
   *
   * @param program
   * @returns object with numbers
   */
  getUniformLocations(
    program: WebGLProgram,
  ): Record<string, WebGLUniformLocation> {
    const gl = this.gl;
    const length = gl.getProgramParameter(
      program,
      gl.ACTIVE_UNIFORMS,
    ) as number;
    const result = {} as Record<string, WebGLUniformLocation>;
    for (let i = 0; i < length; i++) {
      const info = gl.getActiveUniform(program, i) as WebGLActiveInfo;
      // WebGL reports an array as `name[0]`. Key it by the bare name, whose
      // location is element 0, so uniform*fv('name', ...) fills the whole
      // array from there (LinearGradient's u_colors, the border shaders'
      // packed u_params).
      let name = info.name.replace(/\[.*?\]/g, '');
      result[name] = gl.getUniformLocation(
        program,
        name,
      ) as WebGLUniformLocation;
    }
    return result;
  }

  /**
   * Returns object with Attribute names as key and numbers as location values
   * @param program
   * @returns object with numbers
   */
  getAttributeLocations(program: WebGLProgram): string[] {
    const gl = this.gl;
    const length = gl.getProgramParameter(
      program,
      gl.ACTIVE_ATTRIBUTES,
    ) as number;

    const result: string[] = [];
    for (let i = 0; i < length; i++) {
      const { name } = gl.getActiveAttrib(program, i) as WebGLActiveInfo;
      result[gl.getAttribLocation(program, name)] = name;
    }
    return result;
  }

  /**
   * ```
   * gl.useProgram(program);
   * ```
   *
   * @param program
   * @returns
   */
  useProgram(
    program: WebGLProgram | null,
    uniformLocations: Record<string, WebGLUniformLocation>,
  ) {
    if (this.curProgram === program) {
      return;
    }
    this.gl.useProgram(program);
    this.curProgram = program;
    this.curUniformLocations = uniformLocations;
  }

  /**
   * Sets the value of a single float uniform variable.
   *
   * @param location - The location of the uniform variable.
   * @param v0 - The value to set.
   */
  uniform1f(location: string, v0: number) {
    this.gl.uniform1f(this.curUniformLocations[location] || null, v0);
  }

  /**
   * Sets the value of a float array uniform variable.
   *
   * @param location - The location of the uniform variable.
   * @param value - The array of values to set.
   */
  uniform1fv(location: string, value: Float32Array) {
    this.gl.uniform1fv(this.curUniformLocations[location] || null, value);
  }

  /**
   * Sets the value of a single integer uniform variable.
   *
   * @param location - The location of the uniform variable.
   * @param v0 - The value to set.
   */
  uniform1i(location: string, v0: number) {
    this.gl.uniform1i(this.curUniformLocations[location] || null, v0);
  }

  /**
   * Sets the value of an integer array uniform variable.
   *
   * @param location - The location of the uniform variable.
   * @param value - The array of values to set.
   */
  uniform1iv(location: string, value: Int32Array) {
    this.gl.uniform1iv(this.curUniformLocations[location] || null, value);
  }

  /**
   * Sets the value of a vec2 uniform variable.
   *
   * @param location - The location of the uniform variable.
   * @param v0 - The first component of the vector.
   * @param v1 - The second component of the vector.
   */
  uniform2f(location: string, v0: number, v1: number) {
    this.gl.uniform2f(this.curUniformLocations[location] || null, v0, v1);
  }

  /**
   * Sets the value of a vec2 array uniform variable.
   *
   * @param location - The location of the uniform variable.
   * @param value - The array of vec2 values to set.
   */
  uniform2fv(location: string, value: Float32Array) {
    this.gl.uniform2fv(this.curUniformLocations[location] || null, value);
  }

  /**
   * Sets the value of a ivec2 uniform variable.
   *
   * @param location - The location of the uniform variable.
   * @param v0 - The first component of the vector.
   * @param v1 - The second component of the vector.
   */
  uniform2i(location: string, v0: number, v1: number) {
    this.gl.uniform2i(this.curUniformLocations[location] || null, v0, v1);
  }

  /**
   * Sets the value of an ivec2 array uniform variable.
   *
   * @param location - The location of the uniform variable.
   * @param value - The array of ivec2 values to set.
   */
  uniform2iv(location: string, value: Int32Array) {
    this.gl.uniform2iv(this.curUniformLocations[location] || null, value);
  }

  /**
   * Sets the value of a vec3 uniform variable.
   *
   * @param location - The location of the uniform variable.
   * @param v0 - The first component of the vector.
   * @param v1 - The second component of the vector.
   * @param v2 - The third component of the vector.
   */
  uniform3f(location: string, v0: number, v1: number, v2: number) {
    this.gl.uniform3f(this.curUniformLocations[location] || null, v0, v1, v2);
  }

  /**
   * Sets the value of a vec3 array uniform variable.
   *
   * @param location - The location of the uniform variable.
   * @param value - The array of vec3 values to set.
   */
  uniform3fv(location: string, value: Float32Array) {
    this.gl.uniform3fv(this.curUniformLocations[location] || null, value);
  }

  /**
   * Sets the value of a ivec3 uniform variable.
   *
   * @param location - The location of the uniform variable.
   * @param v0 - The first component of the vector.
   * @param v1 - The second component of the vector.
   * @param v2 - The third component of the vector.
   */
  uniform3i(location: string, v0: number, v1: number, v2: number) {
    this.gl.uniform3i(this.curUniformLocations[location] || null, v0, v1, v2);
  }

  /**
   * Sets the value of an ivec3 array uniform variable.
   *
   * @param location - The location of the uniform variable.
   * @param value - The array of ivec3 values to set.
   */
  uniform3iv(location: string, value: Int32Array) {
    this.gl.uniform3iv(this.curUniformLocations[location] || null, value);
  }

  /**
   * Sets the value of a vec4 uniform variable.
   *
   * @param location - The location of the uniform variable.
   * @param v0 - The first component of the vector.
   * @param v1 - The second component of the vector.
   * @param v2 - The third component of the vector.
   * @param v3 - The fourth component of the vector.
   */
  uniform4f(location: string, v0: number, v1: number, v2: number, v3: number) {
    this.gl.uniform4f(
      this.curUniformLocations[location] || null,
      v0,
      v1,
      v2,
      v3,
    );
  }

  /**
   * Sets the value of a vec4 array uniform variable.
   *
   * @param location - The location of the uniform variable.
   * @param value - The array of vec4 values to set.
   */
  uniform4fv(location: string, value: Float32Array) {
    this.gl.uniform4fv(this.curUniformLocations[location] || null, value);
  }

  /**
   * Sets the value of a ivec4 uniform variable.
   *
   * @param location - The location of the uniform variable.
   * @param v0 - The first component of the vector.
   * @param v1 - The second component of the vector.
   * @param v2 - The third component of the vector.
   * @param v3 - The fourth component of the vector.
   */
  uniform4i(location: string, v0: number, v1: number, v2: number, v3: number) {
    this.gl.uniform4i(
      this.curUniformLocations[location] || null,
      v0,
      v1,
      v2,
      v3,
    );
  }

  /**
   * Sets the value of an ivec4 array uniform variable.
   *
   * @param location - The location of the uniform variable.
   * @param value - The array of ivec4 values to set.
   */
  uniform4iv(location: string, value: Int32Array) {
    this.gl.uniform4iv(this.curUniformLocations[location] || null, value);
  }

  /**
   * Sets the value of a mat2 uniform variable.
   *
   * @param location - The location of the uniform variable.
   * @param transpose - Whether to transpose the matrix.
   * @param value - The array of mat2 values to set.
   */
  uniformMatrix2fv(location: string, value: Float32Array) {
    this.gl.uniformMatrix2fv(
      this.curUniformLocations[location] || null,
      false,
      value,
    );
  }

  /**
   * Sets the value of a mat2 uniform variable.
   * @param location - The location of the uniform variable.
   * @param value - The array of mat2 values to set.
   */
  uniformMatrix3fv(location: string, value: Float32Array) {
    this.gl.uniformMatrix3fv(
      this.curUniformLocations[location] || null,
      false,
      value,
    );
  }

  /**
   * Sets the value of a mat4 uniform variable.
   * @param location - The location of the uniform variable.
   * @param value - The array of mat4 values to set.
   */
  uniformMatrix4fv(location: string, value: Float32Array) {
    this.gl.uniformMatrix4fv(
      this.curUniformLocations[location] || null,
      false,
      value,
    );
  }

  /**
   * ```
   * gl.getParameter(pname);
   * ```
   *
   * @param pname
   * @returns
   */
  getParameter(pname: GLenum): any {
    return this.gl.getParameter(pname);
  }

  /**
   * ```
   * gl.drawElements(mode, count, type, offset);
   * ```
   *
   * @param mode
   * @param count
   * @param type
   * @param offset
   */
  drawElements(mode: GLenum, count: GLsizei, type: GLenum, offset: GLintptr) {
    this.gl.drawElements(mode, count, type, offset);
  }

  /**
   * ```
   * gl.drawArrays(mode, first, count);
   * ```
   *
   * @param name
   * @returns
   */
  getExtension(name: string) {
    return this.gl.getExtension(name);
  }

  /**
   * ```
   * gl.getError(type);
   * ```
   *
   * @returns
   */
  getError() {
    return this.gl.getError();
  }

  /**
   * ```
   * gl.isContextLost();
   * ```
   *
   * @remarks
   * Reports the current lost state directly and is not consumed like
   * `getError()` (whose `CONTEXT_LOST_WEBGL` flag is cleared on first read).
   * Use this to detect a lost context after a GL call has already failed.
   *
   * @returns
   */
  isContextLost() {
    return this.gl.isContextLost();
  }

  /**
   * ```
   * gl.enableVertexAttribArray(index);
   * ```
   *
   * @param index
   */
  enableVertexAttribArray(index: number) {
    this.gl.enableVertexAttribArray(index);
  }

  /**
   * ```
   * gl.disableVertexAttribArray(index);
   * ```
   *
   * @param index
   */
  disableVertexAttribArray(index: number) {
    this.gl.disableVertexAttribArray(index);
  }

  /**
   * ```
   * gl.createShader(type);
   * ```
   *
   * @param type
   * @returns
   */
  createShader(type: number) {
    return this.gl.createShader(type);
  }

  /**
   * ```
   * gl.compileShader(shader);
   * ```
   *
   * @param shader
   * @returns
   */
  compileShader(shader: WebGLShader) {
    this.gl.compileShader(shader);
  }

  /**
   * ```
   * gl.attachShader(program, shader);
   * ```
   *
   * @param program
   * @param shader
   */
  attachShader(program: WebGLProgram, shader: WebGLShader) {
    this.gl.attachShader(program, shader);
  }

  /**
   * ```
   * gl.linkProgram(program);
   * ```
   *
   * @param program
   */
  linkProgram(program: WebGLProgram) {
    this.gl.linkProgram(program);
  }

  /**
   * ```
   * gl.deleteProgram(shader);
   * ```
   *
   * @param shader
   */
  deleteProgram(shader: WebGLProgram) {
    this.gl.deleteProgram(shader);
  }

  /**
   * ```
   * gl.getShaderParameter(shader, pname);
   * ```
   *
   * @param shader
   * @param pname
   */
  getShaderParameter(shader: WebGLShader, pname: GLenum) {
    return this.gl.getShaderParameter(shader, pname);
  }

  /**
   * ```
   * gl.getShaderInfoLog(shader);
   * ```
   *
   * @param shader
   */
  getShaderInfoLog(shader: WebGLShader) {
    return this.gl.getShaderInfoLog(shader);
  }

  /**
   * ```
   * gl.createProgram();
   * ```
   *
   * @returns
   */
  createProgram() {
    return this.gl.createProgram();
  }

  /**
   * ```
   * gl.getProgramParameter(program, pname);
   * ```
   *
   * @param program
   * @param pname
   * @returns
   */
  getProgramParameter(program: WebGLProgram, pname: GLenum) {
    return this.gl.getProgramParameter(program, pname);
  }

  /**
   * ```
   * gl.getProgramInfoLog(program);
   * ```
   *
   * @param program
   * @returns
   */
  getProgramInfoLog(program: WebGLProgram) {
    return this.gl.getProgramInfoLog(program);
  }

  /**
   * ```
   * gl.shaderSource(shader, source);
   * ```
   *
   * @param shader
   * @param source
   */
  shaderSource(shader: WebGLShader, source: string) {
    this.gl.shaderSource(shader, source);
  }

  /**
   * ```
   * gl.deleteShader(shader);
   * ```
   *
   * @param shader
   */
  deleteShader(shader: WebGLShader) {
    this.gl.deleteShader(shader);
  }
}
