import { createAngle } from './angle.mjs';
// SDL 3.2 event layouts. Decode only the public fixed-width fields we consume.
import koffi from 'koffi';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.platform === 'win32' && process.arch === 'x64') {
  const base = fileURLToPath(new URL('./windows/lib/', import.meta.url));
  process.env.SOLID_ANGLE_DIR ??= path.join(base, 'angle');
  process.env.SOLID_SDL3_LIBRARY ??= path.join(base, 'SDL3.dll');
}
if (process.platform === 'win32' && process.env.SOLID_ANGLE_DIR) {
  const bin = process.env.SOLID_ANGLE_DIR;
  process.env.PATH = bin + path.delimiter + process.env.PATH;
  process.env.SDL_OPENGL_ES_DRIVER = '1';
  process.env.SDL_EGL_LIBRARY = path.join(bin, 'libEGL.dll');
  process.env.SDL_OPENGL_LIBRARY = path.join(bin, 'libGLESv2.dll');
}
const library =
  process.env.SOLID_SDL3_LIBRARY ??
  { win32: 'SDL3.dll', darwin: 'libSDL3.dylib' }[process.platform] ??
  'libSDL3.so.0';
const sdl = koffi.load(library);
const fn = (declaration) => sdl.func(declaration);
const init = fn('bool SDL_Init(uint32_t flags)'),
  quit = fn('void SDL_Quit()');
const create = fn('void *SDL_CreateWindow(const char *,int,int,uint64_t)'),
  destroy = fn('void SDL_DestroyWindow(void *)');
const context = fn('void *SDL_GL_CreateContext(void *)'),
  release = fn('bool SDL_GL_DestroyContext(void *)');
const show = fn('bool SDL_ShowWindow(void *)');
const swap = fn('bool SDL_GL_SwapWindow(void *)'),
  vsync = fn('bool SDL_GL_SetSwapInterval(int)');
const poll = fn('bool SDL_PollEvent(void *)'),
  error = fn('const char *SDL_GetError()');
const proc = fn('void *SDL_GL_GetProcAddress(const char *)');
const properties = fn('uint32_t SDL_GetWindowProperties(void *)');
const number = fn(
  'int64_t SDL_GetNumberProperty(uint32_t,const char *,int64_t)',
);
const pointer = fn(
  'void *SDL_GetPointerProperty(uint32_t,const char *,void *)',
);
const position = fn(
  'bool SDL_GetWindowPosition(void *, _Out_ int *, _Out_ int *)',
);
const size = fn('bool SDL_GetWindowSize(void *, _Out_ int *, _Out_ int *)');
const pixels = fn(
  'bool SDL_GetWindowSizeInPixels(void *, _Out_ int *, _Out_ int *)',
);
const textStart = fn('bool SDL_StartTextInput(void *)'),
  textStop = fn('bool SDL_StopTextInput(void *)');
const textArea = fn('bool SDL_SetTextInputArea(void *,const int *,int)');
const setClipboard = fn('bool SDL_SetClipboardText(str)');
const getClipboard = fn('void *SDL_GetClipboardText()');
const free = fn('void SDL_free(void *)');
const keyName = fn('const char *SDL_GetKeyName(uint32_t)');
const names = {
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Return: 'Enter',
  Space: ' ',
};
export function openWindow(title) {
  if (!init(0x20)) throw new Error(error());
  const setAttr = fn('bool SDL_GL_SetAttribute(int,int)');
  // SDL_GL_CONTEXT_PROFILE_MASK, MAJOR_VERSION and MINOR_VERSION.
  // Use an ES context where available; macOS exposes desktop core OpenGL.
  let handle,
    gl,
    core = false;
  const profiles = process.platform === 'darwin' ? [1] : [4, 1];
  let angle;
  if (process.platform === 'win32' && process.env.SOLID_ANGLE_DIR) {
    handle = create(title, 960, 600, 0x2028);
    if (!handle) {
      const reason = error();
      quit();
      throw new Error(reason);
    }
    try {
      angle = createAngle(
        pointer(properties(handle), 'SDL.window.win32.hwnd', null),
        process.env.SOLID_ANGLE_DIR,
      );
    } catch (e) {
      destroy(handle);
      quit();
      throw e;
    }
  }
  for (const profile of angle ? [] : profiles) {
    setAttr(20, profile);
    setAttr(17, 3);
    setAttr(18, profile === 1 ? 2 : 0);
    handle = create(title, 960, 600, 0x202a);
    if (handle) {
      gl = context(handle);
      if (gl) {
        core = profile === 1;
        break;
      }
      destroy(handle);
      handle = null;
    }
  }
  if (!gl && !angle) {
    const reason = error();
    quit();
    throw new Error(reason);
  }
  if (!angle) vsync(1);
  const buffer = Buffer.alloc(128);
  return {
    handle,
    show: () => show(handle),
    core,
    bind: angle?.bind,
    proc,
    accessHandle() {
      const id = properties(handle);
      return process.platform === 'darwin'
        ? pointer(id, 'SDL.window.cocoa.window', null)
        : process.platform === 'win32'
          ? pointer(id, 'SDL.window.win32.hwnd', null)
          : null;
    },
    nativeVideoId() {
      const id = properties(handle);
      if (process.platform === 'win32') {
        const hwnd = pointer(id, 'SDL.window.win32.hwnd', null);
        return hwnd ? String(koffi.address(hwnd)) : null;
      }
      const xid = number(id, 'SDL.window.x11.window', 0);
      return xid ? String(xid) : null;
    },
    swap: () => (angle ? angle.present() : swap(handle)),
    imeRect(r) {
      const box = Int32Array.from([r.x, r.y, r.width, r.height], Math.round);
      textArea(handle, box, 0);
    },
    copy: (s) => setClipboard(s),
    paste() {
      const data = getClipboard();
      if (!data) return '';
      try {
        return koffi.decode(data, 'char', -1);
      } finally {
        free(data);
      }
    },
    textInput(enabled) {
      return enabled ? textStart(handle) : textStop(handle);
    },
    geometry() {
      const w = [0],
        h = [0],
        pw = [0],
        ph = [0];
      size(handle, w, h);
      pixels(handle, pw, ph);
      const x = [0],
        y = [0];
      position(handle, x, y);
      return {
        x: x[0],
        y: y[0],
        width: w[0],
        height: h[0],
        pixelWidth: pw[0],
        pixelHeight: ph[0],
        scale: pw[0] / Math.max(w[0], 1),
      };
    },
    events(send) {
      while (poll(buffer)) {
        const type = buffer.readUInt32LE(0);
        if (type === 0x100 || type === 0x210) {
          send('close');
          return;
        }
        if (type === 0x206 || type === 0x207 || type === 0x214) send('resize');
        else if (type === 0x204) send('expose');
        else if (type === 0x20f) send('blur');
        else if (type === 0x20e) send('focus');
        else if (type === 0x300 || type === 0x301) {
          const raw = keyName(buffer.readUInt32LE(28));
          send(type === 0x300 ? 'keydown' : 'keyup', {
            key: names[raw] ?? raw,
            repeat: !!buffer[37],
            shiftKey: !!(buffer.readUInt16LE(32) & 3),
            ctrlKey: !!(buffer.readUInt16LE(32) & 0xc0),
            metaKey: !!(buffer.readUInt16LE(32) & 0xc00),
          });
        } else if (type >= 0x400 && type <= 0x402) {
          send(['pointermove', 'pointerdown', 'pointerup'][type - 0x400], {
            pointerId: 1,
            pointerType: 'mouse',
            button: type === 0x400 ? -1 : buffer[24] - 1,
            clientX: buffer.readFloatLE(28),
            clientY: buffer.readFloatLE(32),
          });
        } else if (type === 0x403) {
          const direction = buffer.readUInt32LE(32) === 1 ? -1 : 1;
          send('wheel', {
            deltaX: buffer.readFloatLE(24) * direction,
            deltaY: -buffer.readFloatLE(28) * direction,
            deltaMode: 1,
            clientX: buffer.readFloatLE(36),
            clientY: buffer.readFloatLE(40),
          });
        } else if (type === 0x303 || type === 0x302) {
          const text = koffi.decode(buffer.subarray(24), 'const char *');
          send(type === 0x303 ? 'textinput' : 'compositionupdate', {
            data: text ?? '',
          });
        }
      }
    },
    close() {
      if (angle) angle.close();
      else release(gl);
      destroy(handle);
      quit();
    },
  };
}
