// Only the renderer's GL operations cross this boundary. SDL selects the entry
// points from the current context, including EGL/ANGLE and macOS core GL.
import koffi from 'koffi';

export function createGraphics(window, canvas) {
  function bind(name, result, params) {
    if (window.bind) return window.bind('gl' + name, result, params);
    const address = window.proc('gl' + name);
    if (!address) throw new Error('The desktop context lacks gl' + name);
    const type = koffi.proto(result, params);
    return koffi.decode(address, type);
  }
  const u = 'uint32_t',
    i = 'int32_t',
    f = 'float',
    v = 'void',
    b = 'bool',
    p = 'void *';
  const gl = {
    canvas,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    get drawingBufferWidth() {
      return canvas.width;
    },
    get drawingBufferHeight() {
      return canvas.height;
    },
    isContextLost: () => false,
    getExtension: () => null,
  };
  const funcs = {
    Viewport: [v, [i, i, i, i]],
    Enable: [v, [u]],
    Disable: [v, [u]],
    BlendFunc: [v, [u, u]],
    Clear: [v, [u]],
    ClearColor: [v, [f, f, f, f]],
    Scissor: [v, [i, i, i, i]],
    CreateShader: [u, [u]],
    CompileShader: [v, [u]],
    CreateProgram: [u, []],
    AttachShader: [v, [u, u]],
    BindAttribLocation: [v, [u, u, 'str']],
    LinkProgram: [v, [u]],
    UseProgram: [v, [u]],
    BindBuffer: [v, [u, u]],
    EnableVertexAttribArray: [v, [u]],
    VertexAttribPointer: [v, [u, i, u, b, i, 'uintptr_t']],
    DrawElements: [v, [u, i, u, 'uintptr_t']],
    BindTexture: [v, [u, u]],
    TexParameteri: [v, [u, u, i]],
    BindVertexArray: [v, [u]],
    GetError: [u, []],
    Uniform1f: [v, [i, f]],
    Uniform2f: [v, [i, f, f]],
    Uniform4f: [v, [i, f, f, f, f]],
  };
  for (const [name, [result, args]] of Object.entries(funcs)) {
    gl[name[0].toLowerCase() + name.slice(1)] = bind(name, result, args);
  }
  for (const [method, resource] of [
    ['createBuffer', 'Buffers'],
    ['createTexture', 'Textures'],
    ['createVertexArray', 'VertexArrays'],
  ]) {
    const gen = bind('Gen' + resource, v, [i, '_Out_ uint32_t *']);
    gl[method] = () => {
      const id = [0];
      gen(1, id);
      return id[0];
    };
  }
  const del = bind('DeleteTextures', v, [i, 'const uint32_t *']);
  gl.deleteTexture = (id) => del(1, [id]);
  const bufferData = bind('BufferData', v, [u, 'intptr_t', p, u]);
  gl.bufferData = (target, data, usage) =>
    bufferData(target, data.byteLength, data, usage);
  const source = bind('ShaderSource', v, [
    u,
    i,
    'const char **',
    'const int32_t *',
  ]);
  const shaderInfo = bind('GetShaderiv', v, [u, u, '_Out_ int32_t *']);
  gl.shaderSource = (shader, code) => {
    if (window.core) {
      const type = [0];
      shaderInfo(shader, 0x8b4f, type);
      const fragment = type[0] === 0x8b30;
      code =
        '#version 150\n' +
        (fragment ? 'out vec4 fragmentColor;\n' : '') +
        code
          .replace(/precision\s+(?:lowp|mediump|highp)\s+\w+\s*;/g, '')
          .replace(/\battribute\b/g, 'in')
          .replace(/\bvarying\b/g, fragment ? 'in' : 'out')
          .replace(/\btexture2D\b/g, 'texture')
          .replace(/\bgl_FragColor\b/g, 'fragmentColor');
    }
    source(shader, 1, [code], null);
  };
  const programInfo = bind('GetProgramiv', v, [u, u, '_Out_ int32_t *']);
  gl.getProgramParameter = (program, param) => {
    const value = [0];
    programInfo(program, param, value);
    return param === 0x8b82 ? value[0] !== 0 : value[0];
  };
  for (const [kind, info] of [
    ['Program', programInfo],
    ['Shader', shaderInfo],
  ]) {
    const log = bind('Get' + kind + 'InfoLog', v, [u, i, '_Out_ int32_t *', p]);
    gl['get' + kind + 'InfoLog'] = (object) => {
      const len = [0];
      info(object, 0x8b84, len);
      const buf = Buffer.alloc(Math.max(len[0], 1));
      log(object, buf.length, len, buf);
      return buf.toString('utf8', 0, len[0]);
    };
  }
  const getInt = bind('GetIntegerv', v, [u, '_Out_ int32_t *']);
  gl.getParameter = (param) => {
    if (param !== 0x0d33 && param !== 0x8872)
      throw new Error('Unsupported scalar parameter');
    const value = [0];
    getInt(param, value);
    return value[0];
  };
  const location = bind('GetUniformLocation', i, [u, 'str']);
  gl.getUniformLocation = (program, name) => {
    const n = location(program, name);
    return n < 0 ? null : n;
  };
  for (let dim = 1; dim <= 4; dim++)
    for (const [suffix, type] of [
      ['fv', 'float'],
      ['iv', 'int32_t'],
    ]) {
      const fn = bind('Uniform' + dim + suffix, v, [
        i,
        i,
        'const ' + type + ' *',
      ]);
      gl['uniform' + dim + suffix] = (loc, data) => {
        if (loc !== null) fn(loc, Math.floor(data.length / dim), data);
      };
    }
  for (let dim = 2; dim <= 4; dim++) {
    const fn = bind('UniformMatrix' + dim + 'fv', v, [
      i,
      i,
      b,
      'const float *',
    ]);
    gl['uniformMatrix' + dim + 'fv'] = (loc, transpose, data) => {
      if (loc !== null)
        fn(loc, Math.floor(data.length / (dim * dim)), !!transpose, data);
    };
  }
  const image = bind('TexImage2D', v, [u, i, i, i, i, i, u, u, p]);
  const subImage = bind('TexSubImage2D', v, [u, i, i, i, i, i, u, u, p]);
  const read = bind('ReadPixels', v, [i, i, i, i, u, u, p]);
  let premultiply = false;
  const pixelStore = bind('PixelStorei', v, [u, i]);
  gl.pixelStorei = (key, value) => {
    if (key === 0x9241) premultiply = !!value;
    else pixelStore(key, Number(value));
  };
  function pixels(width, height, format, type, data) {
    if (
      format !== gl.RGBA ||
      type !== gl.UNSIGNED_BYTE ||
      !Number.isSafeInteger(width * height * 4) ||
      width < 0 ||
      height < 0
    )
      throw new TypeError('Expected 8-bit RGBA pixels');
    if (
      data != null &&
      (!ArrayBuffer.isView(data) || data.byteLength < width * height * 4)
    )
      throw new RangeError('Incomplete RGBA buffer');
    return data;
  }
  function sourcePixels(src) {
    const data = pixels(
      src.width,
      src.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      src.data,
    );
    if (!premultiply || src.premultiplied) return data;
    const out = Buffer.from(data);
    for (let n = 0; n < out.length; n += 4) {
      const a = out[n + 3] / 255;
      for (let c = 0; c < 3; c++) out[n + c] = Math.round(out[n + c] * a);
    }
    return out;
  }
  gl.texImage2D = (target, level, internal, ...args) => {
    if (args.length === 3) {
      const [format, type, src] = args;
      return image(
        target,
        level,
        internal,
        src.width,
        src.height,
        0,
        format,
        type,
        sourcePixels(src),
      );
    }
    const [w, h, border, format, type, data] = args;
    image(
      target,
      level,
      internal,
      w,
      h,
      border,
      format,
      type,
      pixels(w, h, format, type, data),
    );
  };
  gl.texSubImage2D = (target, level, x, y, ...args) => {
    if (args.length === 3) {
      const [format, type, src] = args;
      return subImage(
        target,
        level,
        x,
        y,
        src.width,
        src.height,
        format,
        type,
        sourcePixels(src),
      );
    }
    const [w, h, format, type, data] = args;
    subImage(
      target,
      level,
      x,
      y,
      w,
      h,
      format,
      type,
      pixels(w, h, format, type, data),
    );
  };
  gl.readPixels = (x, y, w, h, format, type, data) => {
    if (!data) throw new Error('Pixel destination required');
    read(x, y, w, h, format, type, pixels(w, h, format, type, data));
  };
  return gl;
}
