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
export declare class WebGlContextWrapper {
    private gl;
    private activeTextureUnit;
    /**
     * TEXTURE_2D binding on the active unit. Every caller uses unit 0, so one
     * slot replaces a per-unit table; switching units resets it to `undefined`
     * (unknown), which forces the next bind through.
     */
    private boundTexture;
    private texture2dParams;
    private scissorEnabled;
    private scissorX;
    private scissorY;
    private scissorWidth;
    private scissorHeight;
    private boundArrayBuffer;
    private boundElementArrayBuffer;
    private curProgram;
    private curUniformLocations;
    private gl2;
    /**
     * Currently bound Vertex Array Object (`null` is the default VAO).
     *
     * Every quad render op re-binds the same object: all CoreNode ops share the
     * renderer's `quadBufferCollection`, so a program's VAO cache hands back one
     * VAO for the whole frame. Without this shadow that is one GL call per op,
     * out of the three a plain image op costs.
     */
    private boundVertexArray;
    private vaoExt;
    /**
     * True when Vertex Array Objects are available (native WebGL2 or the
     * `OES_vertex_array_object` WebGL1 extension). Lets callers cache attribute
     * layout in a VAO and bind it with a single call instead of re-pointing
     * every attribute on each draw.
     */
    readonly canUseVertexArrayObject: boolean;
    /** True when the underlying context is a WebGL2RenderingContext. */
    readonly isWebGl2: boolean;
    readonly canvas: HTMLCanvasElement | OffscreenCanvas;
    /**
     * Cached copies of `canvas.width`/`canvas.height`.
     *
     * @remarks
     * On HTMLCanvasElement these are DOM getters that cross into Blink — too
     * slow to read per render op per frame on embedded targets. The canvas is
     * sized once, before the renderer is created, and never resized after.
     */
    readonly canvasW: number;
    readonly canvasH: number;
    readonly MAX_RENDERBUFFER_SIZE: any;
    readonly MAX_TEXTURE_SIZE: any;
    readonly MAX_VIEWPORT_DIMS: any;
    readonly MAX_VERTEX_TEXTURE_IMAGE_UNITS: any;
    readonly MAX_TEXTURE_IMAGE_UNITS: any;
    readonly MAX_COMBINED_TEXTURE_IMAGE_UNITS: any;
    readonly MAX_VERTEX_ATTRIBS: any;
    readonly MAX_VARYING_VECTORS: any;
    readonly MAX_VERTEX_UNIFORM_VECTORS: any;
    readonly MAX_FRAGMENT_UNIFORM_VECTORS: any;
    readonly TEXTURE_MAG_FILTER: any;
    readonly TEXTURE_MIN_FILTER: any;
    readonly TEXTURE_WRAP_S: any;
    readonly TEXTURE_WRAP_T: any;
    readonly LINEAR: any;
    readonly LINEAR_MIPMAP_LINEAR: any;
    readonly CLAMP_TO_EDGE: any;
    readonly RGB: any;
    readonly RGBA: any;
    readonly UNSIGNED_BYTE: any;
    readonly UNPACK_PREMULTIPLY_ALPHA_WEBGL: any;
    readonly UNPACK_FLIP_Y_WEBGL: any;
    readonly FLOAT: any;
    readonly TRIANGLES: any;
    readonly UNSIGNED_SHORT: any;
    readonly ONE: any;
    readonly ONE_MINUS_SRC_ALPHA: any;
    readonly VERTEX_SHADER: any;
    readonly FRAGMENT_SHADER: any;
    readonly STATIC_DRAW: any;
    readonly COMPILE_STATUS: any;
    readonly LINK_STATUS: any;
    readonly DYNAMIC_DRAW: any;
    readonly INVALID_ENUM: number;
    readonly INVALID_OPERATION: number;
    constructor(gl: WebGLRenderingContext | WebGL2RenderingContext, disableVertexArrayObject?: boolean);
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
    activeTexture(textureUnit: number): void;
    /**
     * ```
     * gl.bindTexture(gl.TEXTURE_2D, texture);
     * ```
     * @remarks
     * **WebGL Difference**: Bind target is always `gl.TEXTURE_2D`
     *
     * @param texture
     */
    bindTexture(texture: WebGLTexture | null): void;
    private _getActiveTexture;
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
    texParameteri(pname: number, param: number): void;
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
    texImage2D(level: GLint, internalformat: GLint, width: GLsizei, height: GLsizei, border: GLint, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void;
    texImage2D(level: GLint, internalformat: GLint, format: GLenum, type: GLenum, source: TexImageSource | Uint8Array): void;
    /**
     * ```
     * gl.compressedTexImage2D(gl.TEXTURE_2D, level, internalFormat, width, height, border, data);
     * ```
     *
     * @remarks
     * **WebGL Difference**: Bind target is always `gl.TEXTURE_2D`
     */
    compressedTexImage2D(level: GLint, internalformat: GLenum, width: GLsizei, height: GLsizei, border: GLint, data?: ArrayBufferView): void;
    /**
     * ```
     * gl.pixelStorei(pname, param);
     * ```
     *
     * @param pname
     * @param param
     */
    pixelStorei(pname: GLenum, param: GLint | GLboolean): void;
    /**
     * ```
     * gl.createTexture();
     * ```
     *
     * @returns
     */
    createTexture(): WebGLTexture;
    /**
     * ```
     * gl.deleteTexture(texture);
     * ```
     *
     * @param texture
     */
    deleteTexture(texture: WebGLTexture | null): void;
    /**
     * ```
     * gl.viewport(x, y, width, height);
     * ```
     */
    viewport(x: GLint, y: GLint, width: GLsizei, height: GLsizei): void;
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
    clearColor(red: GLclampf, green: GLclampf, blue: GLclampf, alpha: GLclampf): void;
    /**
     * ```
     * gl["enable"|"disable"](gl.SCISSOR_TEST);
     * ```
     * @param enable
     */
    setScissorTest(enable: boolean): void;
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
    scissor(x: GLint, y: GLint, width: GLsizei, height: GLsizei): void;
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
    setBlend(blend: boolean): void;
    /**
     * ```
     * gl.blendFunc(src, dst);
     * ```
     *
     * @param src
     * @param dst
     */
    blendFunc(src: GLenum, dst: GLenum): void;
    /**
     * ```
     * gl.createBuffer();
     * ```
     *
     * @returns
     */
    createBuffer(): WebGLBuffer;
    /**
     * ```
     * gl.clear(gl.COLOR_BUFFER_BIT);
     * ```
     *
     * @remarks
     * **WebGL Difference**: Clear mask is always `gl.COLOR_BUFFER_BIT`
     */
    clear(): void;
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
    arrayBufferData(buffer: WebGLBuffer | null, data: ArrayBufferView, usage: GLenum): void;
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
    elementArrayBufferData(buffer: WebGLBuffer | null, data: ArrayBufferView, usage: GLenum): void;
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
    vertexAttribPointer(buffer: WebGLBuffer, index: GLuint, size: GLint, type: GLenum, normalized: GLboolean, stride: GLsizei, offset: GLintptr): void;
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
    bindElementArrayBuffer(buffer: WebGLBuffer | null): void;
    /**
     * Creates a Vertex Array Object.
     *
     * @remarks
     * Backed by native WebGL2 or the `OES_vertex_array_object` extension. Returns
     * `null` when neither is available; guard with {@link canUseVertexArrayObject}.
     *
     * @returns
     */
    createVertexArray(): WebGLVertexArrayObject | null;
    /**
     * Binds a Vertex Array Object (or `null` to bind the default VAO).
     *
     * @param vertexArray
     */
    bindVertexArray(vertexArray: WebGLVertexArrayObject | null): void;
    /**
     * Deletes a Vertex Array Object.
     *
     * @param vertexArray
     */
    deleteVertexArray(vertexArray: WebGLVertexArrayObject): void;
    /**
     * Returns object with Attribute names as key and numbers as location values
     *
     * @param program
     * @returns object with numbers
     */
    getUniformLocations(program: WebGLProgram): Record<string, WebGLUniformLocation>;
    /**
     * Returns object with Attribute names as key and numbers as location values
     * @param program
     * @returns object with numbers
     */
    getAttributeLocations(program: WebGLProgram): string[];
    /**
     * ```
     * gl.useProgram(program);
     * ```
     *
     * @param program
     * @returns
     */
    useProgram(program: WebGLProgram | null, uniformLocations: Record<string, WebGLUniformLocation>): void;
    /**
     * Sets the value of a single float uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param v0 - The value to set.
     */
    uniform1f(location: string, v0: number): void;
    /**
     * Sets the value of a float array uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param value - The array of values to set.
     */
    uniform1fv(location: string, value: Float32Array): void;
    /**
     * Sets the value of a single integer uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param v0 - The value to set.
     */
    uniform1i(location: string, v0: number): void;
    /**
     * Sets the value of an integer array uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param value - The array of values to set.
     */
    uniform1iv(location: string, value: Int32Array): void;
    /**
     * Sets the value of a vec2 uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param v0 - The first component of the vector.
     * @param v1 - The second component of the vector.
     */
    uniform2f(location: string, v0: number, v1: number): void;
    /**
     * Sets the value of a vec2 array uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param value - The array of vec2 values to set.
     */
    uniform2fv(location: string, value: Float32Array): void;
    /**
     * Sets the value of a ivec2 uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param v0 - The first component of the vector.
     * @param v1 - The second component of the vector.
     */
    uniform2i(location: string, v0: number, v1: number): void;
    /**
     * Sets the value of an ivec2 array uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param value - The array of ivec2 values to set.
     */
    uniform2iv(location: string, value: Int32Array): void;
    /**
     * Sets the value of a vec3 uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param v0 - The first component of the vector.
     * @param v1 - The second component of the vector.
     * @param v2 - The third component of the vector.
     */
    uniform3f(location: string, v0: number, v1: number, v2: number): void;
    /**
     * Sets the value of a vec3 array uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param value - The array of vec3 values to set.
     */
    uniform3fv(location: string, value: Float32Array): void;
    /**
     * Sets the value of a ivec3 uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param v0 - The first component of the vector.
     * @param v1 - The second component of the vector.
     * @param v2 - The third component of the vector.
     */
    uniform3i(location: string, v0: number, v1: number, v2: number): void;
    /**
     * Sets the value of an ivec3 array uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param value - The array of ivec3 values to set.
     */
    uniform3iv(location: string, value: Int32Array): void;
    /**
     * Sets the value of a vec4 uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param v0 - The first component of the vector.
     * @param v1 - The second component of the vector.
     * @param v2 - The third component of the vector.
     * @param v3 - The fourth component of the vector.
     */
    uniform4f(location: string, v0: number, v1: number, v2: number, v3: number): void;
    /**
     * Sets the value of a vec4 array uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param value - The array of vec4 values to set.
     */
    uniform4fv(location: string, value: Float32Array): void;
    /**
     * Sets the value of a ivec4 uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param v0 - The first component of the vector.
     * @param v1 - The second component of the vector.
     * @param v2 - The third component of the vector.
     * @param v3 - The fourth component of the vector.
     */
    uniform4i(location: string, v0: number, v1: number, v2: number, v3: number): void;
    /**
     * Sets the value of an ivec4 array uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param value - The array of ivec4 values to set.
     */
    uniform4iv(location: string, value: Int32Array): void;
    /**
     * Sets the value of a mat2 uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param transpose - Whether to transpose the matrix.
     * @param value - The array of mat2 values to set.
     */
    uniformMatrix2fv(location: string, value: Float32Array): void;
    /**
     * Sets the value of a mat2 uniform variable.
     * @param location - The location of the uniform variable.
     * @param value - The array of mat2 values to set.
     */
    uniformMatrix3fv(location: string, value: Float32Array): void;
    /**
     * Sets the value of a mat4 uniform variable.
     * @param location - The location of the uniform variable.
     * @param value - The array of mat4 values to set.
     */
    uniformMatrix4fv(location: string, value: Float32Array): void;
    /**
     * ```
     * gl.getParameter(pname);
     * ```
     *
     * @param pname
     * @returns
     */
    getParameter(pname: GLenum): any;
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
    drawElements(mode: GLenum, count: GLsizei, type: GLenum, offset: GLintptr): void;
    /**
     * ```
     * gl.drawArrays(mode, first, count);
     * ```
     *
     * @param name
     * @returns
     */
    getExtension(name: string): any;
    /**
     * ```
     * gl.getError(type);
     * ```
     *
     * @returns
     */
    getError(): number;
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
    isContextLost(): boolean;
    /**
     * ```
     * gl.enableVertexAttribArray(index);
     * ```
     *
     * @param index
     */
    enableVertexAttribArray(index: number): void;
    /**
     * ```
     * gl.disableVertexAttribArray(index);
     * ```
     *
     * @param index
     */
    disableVertexAttribArray(index: number): void;
    /**
     * ```
     * gl.createShader(type);
     * ```
     *
     * @param type
     * @returns
     */
    createShader(type: number): WebGLShader | null;
    /**
     * ```
     * gl.compileShader(shader);
     * ```
     *
     * @param shader
     * @returns
     */
    compileShader(shader: WebGLShader): void;
    /**
     * ```
     * gl.attachShader(program, shader);
     * ```
     *
     * @param program
     * @param shader
     */
    attachShader(program: WebGLProgram, shader: WebGLShader): void;
    /**
     * ```
     * gl.linkProgram(program);
     * ```
     *
     * @param program
     */
    linkProgram(program: WebGLProgram): void;
    /**
     * ```
     * gl.deleteProgram(shader);
     * ```
     *
     * @param shader
     */
    deleteProgram(shader: WebGLProgram): void;
    /**
     * ```
     * gl.getShaderParameter(shader, pname);
     * ```
     *
     * @param shader
     * @param pname
     */
    getShaderParameter(shader: WebGLShader, pname: GLenum): any;
    /**
     * ```
     * gl.getShaderInfoLog(shader);
     * ```
     *
     * @param shader
     */
    getShaderInfoLog(shader: WebGLShader): string | null;
    /**
     * ```
     * gl.createProgram();
     * ```
     *
     * @returns
     */
    createProgram(): WebGLProgram;
    /**
     * ```
     * gl.getProgramParameter(program, pname);
     * ```
     *
     * @param program
     * @param pname
     * @returns
     */
    getProgramParameter(program: WebGLProgram, pname: GLenum): any;
    /**
     * ```
     * gl.getProgramInfoLog(program);
     * ```
     *
     * @param program
     * @returns
     */
    getProgramInfoLog(program: WebGLProgram): string | null;
    /**
     * ```
     * gl.shaderSource(shader, source);
     * ```
     *
     * @param shader
     * @param source
     */
    shaderSource(shader: WebGLShader, source: string): void;
    /**
     * ```
     * gl.deleteShader(shader);
     * ```
     *
     * @param shader
     */
    deleteShader(shader: WebGLShader): void;
}
