import { desktopEditors } from './editors.mjs';
import { desktopSemantics } from './semantics.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createGraphics } from './graphics.mjs';
import { channel } from 'node:diagnostics_channel';
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
const gl = createGraphics(windowHost, surface);
let needsPresent = false;
for (const name of ['clear', 'drawElements']) {
  const operation = gl[name];
  gl[name] = (...args) => {
    operation(...args);
    needsPresent = true;
  };
}
function present() {
  if (needsPresent) {
    needsPresent = false;
    windowHost.swap();
  }
}
surface.getContext = () => gl;
surface.getBoundingClientRect = () => ({
  left: 0,
  top: 0,
  ...windowHost.geometry(),
});
channel('solid.desktop.context').publish(gl);
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
  return {
    data,
    width: info.width,
    height: info.height,
    premultiplied: options?.premultiplyAlpha === 'premultiply',
    close() {},
  };
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
    if (!closed) present();
  }, 1);
  timers.add(timer);
  return timer;
};
globalThis.requestAnimationFrame = frame;
globalThis.cancelAnimationFrame = (timer) => {
  clearTimeout(timer);
  timers.delete(timer);
};
let semantics, editors;
function shutdown() {
  if (closed) return;
  closed = true;
  clearInterval(pump);
  for (const t of timers) clearTimeout(t);
  try {
    dispose?.();
  } finally {
    editors?.dispose();
    semantics?.dispose();
    windowHost.close();
  }
}
try {
  boot = await import('./scene.mjs');
  semantics = desktopSemantics(
    windowHost,
    process.env.SOLID_APP_TITLE ?? 'Solid Multiplatform',
  );
  windowHost.show();
  editors = desktopEditors(windowHost);
  const host = {
    editors,
    semantics,
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
    setTimeout(fn, ms) {
      return setTimeout(() => {
        if (!closed) {
          fn();
          present();
        }
      }, ms);
    },
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
    () => (
      semantics.dispatch(),
      windowHost.events((name, values) => {
        if (name === 'close') return shutdown();
        if (name === 'resize') {
          semantics.resize();
          boot.resize(windowHost.geometry());
          return;
        }
        if (name === 'expose') {
          boot.repaint();
          return;
        }
        if (name === 'blur') {
          pressed = false;
          semantics.active(false);
        }
        if (name === 'focus') semantics.active(true);
        if (editors.handle(name, values)) return;
        messages.dispatchEvent(event(name, values));
        if (name === 'pointerdown' && values.button === 0) pressed = true;
        if (name === 'pointerup' && pressed) {
          pressed = false;
          messages.dispatchEvent(event('click', values));
        }
      })
    ),
    12,
  );
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  shutdown();
  throw error;
}
