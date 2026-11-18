// Own the Windows EGL surface directly. A WGL function table cannot be used for
// an ANGLE context, especially on machines with the Windows OpenGL 1.1 driver.
import path from 'node:path';
import koffi from 'koffi';
export function createAngle(hwnd, dir) {
  const gles = koffi.load(path.join(dir, 'libGLESv2.dll')),
    egl = koffi.load(path.join(dir, 'libEGL.dll'));
  const fn = (s) => egl.func(s);
  const get = fn('void *eglGetProcAddress(str)');
  const displayFactory = get('eglGetPlatformDisplayEXT');
  if (!displayFactory)
    throw new Error('ANGLE platform display extension unavailable');
  const chooseDisplay = koffi.decode(
    displayFactory,
    koffi.proto('void *', ['uint32', 'void *', 'const int32_t *']),
  );
  const init = fn('uint32_t eglInitialize(void *, _Out_ int *, _Out_ int *)');
  const terminate = fn('uint32_t eglTerminate(void *)');
  let display, context, surface;
  for (const device of [[], [0x3209, 0x320b]]) {
    display = chooseDisplay(0x3202, null, [0x3203, 0x3208, ...device, 0x3038]);
    if (display && init(display, [0], [0])) break;
    if (display) terminate(display);
    display = null;
  }
  if (!display) throw new Error('ANGLE could not initialize a D3D11 display');
  const current = fn('uint32_t eglMakeCurrent(void *,void *,void *,void *)');
  const destroySurface = fn('uint32_t eglDestroySurface(void *,void *)'),
    destroyContext = fn('uint32_t eglDestroyContext(void *,void *)');
  const swap = fn('uint32_t eglSwapBuffers(void *,void *)');
  function close() {
    current(display, null, null, null);
    if (surface) destroySurface(display, surface);
    if (context) destroyContext(display, context);
    terminate(display);
  }
  try {
    fn('uint32_t eglBindAPI(uint32_t)')(0x30a0);
    const configs = [null],
      count = [0];
    const choose = fn(
      'uint32_t eglChooseConfig(void *,const int *, _Out_ void **,int,_Out_ int *)',
    );
    if (
      !choose(
        display,
        [
          0x3033, 4, 0x3040, 0x40, 0x3024, 8, 0x3023, 8, 0x3022, 8, 0x3021, 8,
          0x3038,
        ],
        configs,
        1,
        count,
      ) ||
      !count[0]
    )
      throw new Error('No RGBA8 ES3 configuration');
    context = fn('void *eglCreateContext(void *,void *,void *,const int *)')(
      display,
      configs[0],
      null,
      [0x3098, 3, 0x3038],
    );
    surface = fn(
      'void *eglCreateWindowSurface(void *,void *,void *,const int *)',
    )(display, configs[0], hwnd, [0x3038]);
    if (!context || !surface || !current(display, surface, surface, context))
      throw new Error('ANGLE could not attach to the SDL window');
    fn('uint32_t eglSwapInterval(void *,int)')(display, 1);
    return {
      close,
      present: () => swap(display, surface),
      bind: (name, result, args) => gles.func(name, result, args),
    };
  } catch (error) {
    close();
    throw error;
  }
}
