import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import gl from 'webgl-raub';
import sharp from 'sharp';
import { openWindow } from './window.mjs';

const windowHost = openWindow(
  process.env.SOLID_APP_TITLE ?? 'Solid Multiplatform',
);
const work = path.dirname(fileURLToPath(import.meta.url));
function event(name, values = {}) {
  return Object.assign(new Event(name, { cancelable: true }), values);
}
const messages = new EventTarget();
globalThis.window = messages;
globalThis.document = messages;
globalThis.location = pathToFileURL(path.join(work, 'index.html'));
globalThis.self = globalThis;
const surface = new EventTarget();
surface.style = {};
surface.getContext = () => gl;
surface.getBoundingClientRect = () => ({
  left: 0,
  top: 0,
  ...windowHost.geometry(),
});
gl.canvas = surface;
gl.init();
if (windowHost.core) {
  const source = gl.shaderSource.bind(gl);
  gl.shaderSource = (shader, code) => {
    const fragment =
      gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER;
    const translated = code
      .replace(/precision\s+(?:lowp|mediump|highp)\s+\w+\s*;/g, '')
      .replace(/\battribute\b/g, 'in')
      .replace(/\bvarying\b/g, fragment ? 'in' : 'out')
      .replace(/\btexture2D\b/g, 'texture')
      .replace(/\bgl_FragColor\b/g, 'fragmentColor');
    source(
      shader,
      '#version 150\n' +
        (fragment ? 'out vec4 fragmentColor;\n' : '') +
        translated,
    );
  };
}
const texture = gl.texImage2D.bind(gl);
gl.texImage2D = (...args) => {
  const data = args[5];
  if (args.length === 6 && data?.data)
    return texture(
      args[0],
      args[1],
      args[2],
      data.width,
      data.height,
      0,
      args[3],
      args[4],
      data.data,
    );
  return texture(...args);
};
async function load(url) {
  const resolved = new URL(url, globalThis.location);
  if (resolved.protocol === 'file:') return readFile(fileURLToPath(resolved));
  const r = await fetch(resolved, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('Asset request failed: ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}
async function decode(blob, sx, sy, sw, sh, opts) {
  let img = sharp(Buffer.from(await blob.arrayBuffer())).ensureAlpha();
  if (typeof sx === 'number')
    img = img.extract({ left: sx, top: sy, width: sw, height: sh });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const options = typeof sx === 'object' ? sx : opts;
  if (options?.premultiplyAlpha === 'premultiply') {
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * a);
    }
  }
  return { data, width: info.width, height: info.height, close() {} };
}
let boot,
  dispose,
  pump,
  closed = false;
const timers = new Set();
const frame = (callback) => {
  const timer = setTimeout(() => {
    timers.delete(timer);
    if (closed) return;
    callback(performance.now());
    if (!closed) windowHost.swap();
  }, 1);
  timers.add(timer);
  return timer;
};
globalThis.requestAnimationFrame = frame;
globalThis.cancelAnimationFrame = (timer) => {
  clearTimeout(timer);
  timers.delete(timer);
};
function shutdown() {
  if (closed) return;
  closed = true;
  clearInterval(pump);
  for (const t of timers) clearTimeout(t);
  try {
    dispose?.();
  } finally {
    windowHost.close();
  }
}
try {
  boot = await import('./scene.mjs');
  const host = {
    target: 'desktop',
    window: windowHost,
    canvas: surface,
    events: messages,
  };
  boot.install({
    resolveSettings: (s) => ({
      ...s,
      forceWebGL2: false,
      numImageWorkers: 0,
      createImageBitmapSupport: 'full',
      premultiplyAlphaHonored: true,
      presentOnIdle: false,
      resizable: true,
    }),
    createCanvas: () => surface,
    getElementById: () => ({ appendChild() {} }),
    sizeCanvas(canvas, w, h) {
      canvas.width = w;
      canvas.height = h;
    },
    requestAnimationFrame: frame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    now: () => performance.now(),
    setTimeout,
    hidden: () => false,
    present() {},
    createWorker: () => null,
    async fetch(url, type) {
      const b = await load(url);
      return type === 'json'
        ? JSON.parse(b.toString())
        : type === 'blob'
          ? new Blob([b])
          : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
    createImageBitmap: decode,
    createImage() {
      return {
        set src(url) {
          if (!url) return;
          load(url)
            .then((b) => decode(new Blob([b])))
            .then(
              (p) => {
                Object.assign(this, p);
                this.onload?.();
              },
              () => this.onerror?.(),
            );
        },
      };
    },
  });
  boot.resize(windowHost.geometry());
  dispose = boot.start(host);
  let pressed = false;
  pump = setInterval(
    () =>
      windowHost.events((name, values) => {
        if (name === 'close') return shutdown();
        if (name === 'resize') {
          boot.resize(windowHost.geometry());
          return;
        }
        if (name === 'expose') {
          boot.repaint();
          return;
        }
        if (name === 'blur') pressed = false;
        messages.dispatchEvent(event(name, values));
        if (name === 'pointerdown' && values.button === 0) pressed = true;
        if (name === 'pointerup' && pressed) {
          pressed = false;
          messages.dispatchEvent(event('click', values));
        }
      }),
    12,
  );
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  shutdown();
  throw error;
}
