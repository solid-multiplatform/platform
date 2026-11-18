// The Canvas backend's frame loop is event driven: an idle scene schedules
// nothing, and whatever can change what must be drawn asks for exactly one
// frame, with one fallback timer behind it for a host that does not deliver
// the frame. These tests run the built renderer on a real Stage, with the
// frame and timer queues stubbed so that each request can be counted and run
// by hand. One test per wake source: asleep before it, one frame after it.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const FRAME = 1000 / 60;
// The default of the `wakeFallbackDelay` setting.
const FALLBACK = 50;

// Every requestAnimationFrame and setTimeout call made by anything in this
// process lands here, and leaves again when it is cancelled.
const frames = [];
const timers = [];
let requested = 0;
let now = 1000;
const drop = (queue, id) => {
  const at = queue.findIndex((entry) => entry.id === id);
  if (at !== -1) queue.splice(at, 1);
};
globalThis.requestAnimationFrame = (callback) => {
  requested++;
  frames.push({ id: requested, callback });
  return requested;
};
globalThis.cancelAnimationFrame = (id) => drop(frames, id);
globalThis.setTimeout = (callback, ms) => {
  requested++;
  timers.push({ id: requested, callback, ms, at: now + ms });
  return requested;
};
globalThis.clearTimeout = (id) => drop(timers, id);

// What the engine reads of a browser. A canvas counts the frames drawn into
// it: the Canvas renderer clears it once at the start of each.
const canvas = () => {
  const surface = { width: 0, height: 0, draws: 0, getContext: () => context };
  const context = new Proxy(
    {},
    {
      get(state, key) {
        if (key === 'clearRect') return () => surface.draws++;
        if (key === 'measureText')
          return (text) => ({ width: text.length * 10 });
        if (key === 'getImageData') return (x, y, w, h) => new ImageData(w, h);
        return key in state ? state[key] : () => {};
      },
    },
  );
  return surface;
};
class Pixels {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
}
const fontLoads = [];
globalThis.self = globalThis;
globalThis.location = { protocol: 'http:' };
globalThis.document = { createElement: canvas, hidden: false };
globalThis.ImageData = Pixels;
globalThis.ImageBitmap = class extends Pixels {
  close() {}
};
globalThis.HTMLImageElement = class {};
globalThis.FontFace = class {
  load() {
    return new Promise((resolve) => fontLoads.push(() => resolve(this)));
  }
};

// Imported after the globals above: the engine reads some of them on load.
const { RendererMain, CanvasRenderer, CanvasTextRenderer } =
  await import('../dist/canvas/index.js');
const { WebPlatform } =
  await import('../dist/canvas/src/core/platforms/web/WebPlatform.js');
const { Rounded } = await import('../dist/canvas/exports/canvas-shaders.js');

class Platform extends WebPlatform {
  createCanvas() {
    return canvas();
  }
  addFont() {}
  // One clock for the frames and for a tick the fallback runs without one.
  getTimeStamp() {
    return now;
  }
}

/** Let promise continuations and queued microtasks run. */
const tasks = () => new Promise((resolve) => setImmediate(resolve));

/** Time passes and the timers that fall due run. No frame is delivered. */
const wait = (ms) => {
  now += ms;
  for (;;) {
    const due = timers
      .filter((timer) => timer.at <= now)
      .sort((a, b) => a.at - b.at)[0];
    if (due === undefined) return;
    drop(timers, due.id);
    due.callback();
  }
};

/** The host delivers the frames that were requested. */
const deliver = () => {
  for (const frame of frames.splice(0)) frame.callback(now);
};

/** One vsync: the timers that were due before it, then the frame. */
const step = (ms = FRAME) => {
  wait(ms);
  deliver();
};

/** What is pending: [frames, timers]. */
const pending = () => [frames.length, timers.length];

/** Run frames until nothing is pending. */
const settle = async () => {
  for (let ticks = 0; ; ticks++) {
    await tasks();
    if (frames.length === 0 && timers.length === 0) return;
    assert.ok(ticks < 300, 'the loop never stopped scheduling');
    step();
  }
};

/** Nothing is pending, and time passing schedules nothing. */
const assertIdle = async () => {
  assert.equal(frames.length, 0, 'a frame is pending');
  assert.equal(timers.length, 0, 'a timer is pending');
  const before = requested;
  now += 10_000;
  await tasks();
  assert.equal(requested, before, 'something was scheduled while idle');
};

const assertAsleep = async (stage) => {
  assert.equal(stage.loopAsleep, true, 'the loop is not asleep');
  await assertIdle();
};

/**
 * `source` takes a sleeping loop to exactly one requested frame and exactly
 * the one fallback timer behind it.
 */
const assertWakes = async (stage, source, fallback = FALLBACK) => {
  await assertAsleep(stage);
  const before = requested;
  await source();
  await tasks();
  assert.equal(frames.length, 1, 'frames pending after the wake');
  if (fallback > 0) {
    assert.equal(requested - before, 2, 'requests made by the wake');
    assert.equal(timers.length, 1, 'timers pending after the wake');
    assert.equal(timers[0].ms, fallback, 'the fallback delay');
  } else {
    assert.equal(requested - before, 1, 'requests made by the wake');
    assert.equal(timers.length, 0, 'timers pending after the wake');
  }
  assert.equal(stage.loopAsleep, false);
};

/** `source` leaves a sleeping (or stopped) loop alone. */
const assertNoWake = async (source) => {
  const before = requested;
  await source();
  await tasks();
  assert.equal(requested, before, 'something was scheduled');
};

/** A renderer whose first frames have been drawn and whose loop sleeps. */
const scene = async (t, settings = {}) => {
  frames.length = 0;
  timers.length = 0;
  const surface = canvas();
  const renderer = new RendererMain({
    appWidth: 1920,
    appHeight: 1080,
    canvas: surface,
    platform: Platform,
    renderEngine: CanvasRenderer,
    fontEngines: [CanvasTextRenderer],
    numImageWorkers: 0,
    createImageBitmapSupport: 'basic',
    devicePhysicalPixelRatio: 1,
    ...settings,
  });
  t.after(() => renderer.destroy());
  const seen = { idle: 0 };
  renderer.on('idle', () => seen.idle++);
  await settle();
  const box = (props = {}) =>
    renderer.createNode({
      w: 100,
      h: 100,
      color: 0xff0000ff,
      parent: renderer.root,
      ...props,
    });
  return {
    renderer,
    stage: renderer.stage,
    root: renderer.root,
    surface,
    seen,
    box,
  };
};

test('an idle scene schedules nothing, and idle fires once per settle', async (t) => {
  const { stage, surface, seen, box } = await scene(t);
  assert.equal(seen.idle, 1);
  await assertAsleep(stage);
  box();
  await settle();
  assert.equal(seen.idle, 2);
  const draws = surface.draws;
  await assertAsleep(stage);
  assert.equal(surface.draws, draws);
  assert.equal(seen.idle, 2);
});

test('a node prop write wakes the loop once, however many writes follow', async (t) => {
  const { stage, surface, seen, box } = await scene(t);
  const node = box();
  await settle();
  const draws = surface.draws;
  await assertWakes(stage, () => {
    node.x = 10;
  });
  await assertNoWake(() => {
    node.y = 10;
    node.alpha = 0.5;
    node.color = 0x00ff00ff;
    node.w = 200;
  });
  await settle();
  assert.equal(surface.draws, draws + 1);
  assert.equal(seen.idle, 3);
  await assertAsleep(stage);
});

test('a write deep in the tree reaches the root, and stops at a dirty ancestor', async (t) => {
  const { stage, box } = await scene(t);
  const parent = box();
  const child = box({ parent });
  const leaf = box({ parent: child });
  const sibling = box({ parent: child });
  await settle();
  await assertWakes(stage, () => {
    leaf.x = 5;
  });
  // The ancestors are dirty now: this write does not walk to the root.
  await assertNoWake(() => {
    sibling.x = 5;
  });
  await settle();
  await assertWakes(stage, () => {
    sibling.x = 6;
  });
  await settle();
  await assertAsleep(stage);
});

test('a text node write wakes the loop and the new text is laid out', async (t) => {
  const { renderer, root, stage } = await scene(t);
  const label = renderer.createTextNode({
    text: 'Hello',
    fontSize: 30,
    parent: root,
  });
  await settle();
  assert.equal(label.w, 50);
  assert.equal(label.isRenderable, true);
  await assertWakes(stage, () => {
    label.text = 'Hello, world';
  });
  await settle();
  assert.equal(label.w, 120);
  await assertWakes(stage, () => {
    label.fontSize = 40;
  });
  await settle();
  await assertAsleep(stage);
});

test('a detached subtree wakes nothing until it is attached', async (t) => {
  const { stage, root, surface, box } = await scene(t);
  const detached = box({ parent: null });
  const inner = box({ parent: detached });
  await settle();
  await assertAsleep(stage);
  await assertNoWake(() => {
    detached.x = 10;
    inner.x = 20;
    inner.color = 0x0000ffff;
  });
  const draws = surface.draws;
  await assertWakes(stage, () => {
    detached.parent = root;
  });
  await settle();
  assert.ok(surface.draws > draws);
  assert.equal(inner.isRenderable, true);
  // And once attached, a write inside it wakes the loop as any other.
  await assertWakes(stage, () => {
    inner.x = 30;
  });
  await settle();
  await assertAsleep(stage);
});

test('removing and destroying a node each wake the loop', async (t) => {
  const { stage, box } = await scene(t);
  const a = box();
  const b = box();
  await settle();
  await assertWakes(stage, () => {
    a.parent = null;
  });
  await settle();
  await assertWakes(stage, () => {
    b.destroy();
  });
  await settle();
  await assertAsleep(stage);
});

test('requestRender, rerender, the clear colour and a resize each wake the loop', async (t) => {
  const { renderer, stage, surface } = await scene(t);
  for (const source of [
    () => stage.requestRender(),
    () => renderer.requestRender(),
    () => renderer.rerender(),
    () => renderer.setClearColor(0x000000ff),
    () => renderer.setOptions({ clearColor: 0x111111ff }),
    () => renderer.setOptions({ boundsMargin: 200 }),
    () => renderer.resize(1280, 720),
  ]) {
    const draws = surface.draws;
    await assertWakes(stage, source);
    await settle();
    assert.equal(surface.draws, draws + 1, String(source));
  }
  await assertAsleep(stage);
});

test('a shader prop write wakes the loop', async (t) => {
  const { renderer, stage, box } = await scene(t);
  stage.shManager.registerShaderType('Rounded', Rounded);
  const node = box();
  await settle();
  const shader = renderer.createShader('Rounded', { radius: 10 });
  await assertWakes(stage, () => {
    node.shader = shader;
  });
  await settle();
  await assertWakes(stage, () => {
    shader.props.radius = 20;
  });
  await settle();
  await assertAsleep(stage);
});

/** An image whose decode the test finishes by hand. */
const image = (renderer, src) => {
  const texture = renderer.createTexture('ImageTexture', { src });
  const decodes = [];
  texture.getTextureData = () =>
    new Promise((resolve) =>
      decodes.push(() => {
        texture.textureData = {
          data: new ImageBitmap(64, 64),
          premultiplyAlpha: true,
        };
        resolve(texture.textureData);
      }),
    );
  return { texture, decodes };
};

test('an image decode in flight schedules nothing, and wakes the loop when it lands', async (t) => {
  const { renderer, stage, surface, box } = await scene(t);
  const { texture, decodes } = image(renderer, 'http://test/poster.png');
  const node = box({ texture });
  await settle();
  // The fetch and decode are in flight, and the loop sleeps through them.
  assert.equal(decodes.length, 1);
  assert.equal(stage.txManager.hasPendingLoads(), true);
  assert.equal(texture.state, 'loading');
  await assertAsleep(stage);
  const draws = surface.draws;
  // Decoded: the texture joins the upload queue, which only a frame drains.
  await assertWakes(stage, () => decodes[0]());
  assert.equal(stage.txManager.hasUpdates(), true);
  await settle();
  assert.equal(texture.state, 'loaded');
  assert.equal(node.isRenderable, true);
  assert.ok(surface.draws > draws);
  await assertAsleep(stage);
});

test('an image queued before the texture manager is ready wakes the loop', async (t) => {
  const { renderer, stage } = await scene(t);
  const { texture, decodes } = image(renderer, 'http://test/early.png');
  const manager = stage.txManager;
  // As while `createImageBitmap` support is still being probed.
  manager.initialized = false;
  await assertWakes(stage, () => manager.loadTexture(texture));
  // The queue cannot drain yet, and the loop stays up for it.
  step();
  step();
  assert.equal(frames.length, 1);
  manager.initialized = true;
  await settle();
  assert.equal(manager.hasUpdates(), false);
  await assertAsleep(stage);
  // No node shows this texture: its upload changes nothing on screen.
  await assertNoWake(() => decodes[0]());
  assert.equal(texture.state, 'loaded');
});

test('a texture freed or failed under a node wakes the loop', async (t) => {
  const { renderer, stage, box } = await scene(t);
  const { texture, decodes } = image(renderer, 'http://test/freed.png');
  const node = box({ texture });
  await settle();
  decodes[0]();
  await settle();
  assert.equal(node.isRenderable, true);
  await assertWakes(stage, () => stage.txMemManager.freeTexture(texture));
  assert.equal(node.isRenderable, false);
  await settle();
  // The node still wants it: the frame asked for it again, and the loop
  // sleeps through that decode too.
  assert.equal(decodes.length, 2);
  await assertAsleep(stage);
  await assertWakes(stage, () => texture.setState('failed', new Error('gone')));
  await settle();
  await assertAsleep(stage);
});

test('texture memory that turns a cleanup due wakes the loop for it', async (t) => {
  const { stage } = await scene(t);
  // The Canvas renderer turns the thresholds off; turn them on as the WebGL
  // engine has them, since the loop serves both.
  const memory = stage.txMemManager;
  delete memory.setTextureMemUse;
  memory.updateSettings({
    criticalThreshold: 1000,
    targetThresholdLevel: 0.5,
    cleanupInterval: 5000,
    baselineMemoryAllocation: 0,
    doNotExceedCriticalThreshold: false,
    debugLogging: false,
  });
  let cleanups = 0;
  const cleanup = memory.cleanup;
  memory.cleanup = function (full) {
    cleanups++;
    return cleanup.call(this, full);
  };
  await assertAsleep(stage);
  // Below the target: nothing is due.
  await assertNoWake(() => memory.setTextureMemUse({ memUsed: 0 }, 400));
  // Above the critical threshold: a cleanup is due now.
  await assertWakes(stage, () => memory.setTextureMemUse({ memUsed: 0 }, 2000));
  await settle();
  assert.equal(cleanups, 1);
  await assertAsleep(stage);
});

test('an animation wakes the loop, keeps it running, and steps one frame after a sleep', async (t) => {
  const { stage, surface, box } = await scene(t);
  const node = box();
  await settle();
  // A long sleep: the first step must not take it for the frame time.
  now += 60_000;
  const animation = node.animate({ x: 1000 }, { duration: 1000, delay: 100 });
  await assertWakes(stage, () => animation.start());
  // The delay: nothing changes and nothing is drawn, but every tick asks for
  // the next one.
  const draws = surface.draws;
  for (let i = 0; i < 5; i++) {
    step();
    assert.equal(frames.length, 1, 'a frame is pending during the delay');
    assert.equal(timers.length, 0);
  }
  assert.equal(surface.draws, draws);
  assert.equal(node.x, 0);
  // Running: 6 frames of delay, then one frame at a time.
  step();
  step();
  assert.ok(node.x > 0 && node.x < 40, 'x after two steps: ' + node.x);
  assert.equal(frames.length, 1);
  await settle();
  assert.equal(node.x, 1000);
  assert.equal(animation.state, 'stopped');
  await assertAsleep(stage);
});

test('a font that finishes loading wakes the loop and its text is laid out', async (t) => {
  const { renderer, root, stage } = await scene(t);
  fontLoads.length = 0;
  const loaded = stage.loadFont('canvas', {
    fontFamily: 'Late',
    fontUrl: 'late.ttf',
  });
  const label = renderer.createTextNode({
    text: 'Late',
    fontFamily: 'Late',
    fontSize: 30,
    parent: root,
  });
  await settle();
  // Parked on the font, with the loop asleep while it downloads.
  assert.equal(fontLoads.length, 1);
  assert.equal(label.w, 0);
  await assertAsleep(stage);
  await assertWakes(stage, async () => {
    fontLoads[0]();
    await loaded;
  });
  await settle();
  assert.equal(label.w, 40);
  assert.equal(label.isRenderable, true);
  await assertAsleep(stage);
});

test('an event queued while asleep is delivered by one tick that draws nothing', async (t) => {
  const { renderer, stage, surface, seen } = await scene(t);
  const got = [];
  renderer.on('custom', (_, data) => got.push(data));
  const draws = surface.draws;
  await assertWakes(stage, () => stage.queueFrameEvent('custom', 1));
  await assertNoWake(() => stage.queueFrameEvent('custom', 2));
  step();
  assert.deepEqual(got, [1, 2]);
  assert.equal(surface.draws, draws);
  // No burst settled: idle is not announced again.
  assert.equal(seen.idle, 1);
  await assertAsleep(stage);
});

test('fpsUpdate stops with the loop, and a sleep is never sampled as a frame', async (t) => {
  const { renderer, stage, box } = await scene(t, { fpsUpdateInterval: 200 });
  const samples = [];
  renderer.on('fpsUpdate', (_, sample) => samples.push(sample));
  const node = box();
  await settle();
  for (let burst = 0; burst < 3; burst++) {
    // assertAsleep lets 10 seconds pass: no sample closes meanwhile.
    const before = samples.length;
    await assertAsleep(stage);
    assert.equal(samples.length, before);
    node.animate({ x: 100 * (burst + 1) }, { duration: 300 }).start();
    await settle();
  }
  assert.ok(samples.length >= 3, 'samples: ' + samples.length);
  for (const sample of samples) {
    assert.ok(sample.maxFrameTime < 20, 'maxFrameTime ' + sample.maxFrameTime);
    assert.ok(sample.animatedMaxFrameTime < 20);
    if (sample.sampledFrames > 0) assert.equal(sample.fps, 60);
  }
  await assertAsleep(stage);
});

test('a telemetry segment change closes the sample with one tick', async (t) => {
  // An interval no burst here can fill: the sample stays open across sleeps.
  const { renderer, stage, surface, box } = await scene(t, {
    fpsUpdateInterval: 1e9,
  });
  const samples = [];
  renderer.on('fpsUpdate', (_, sample) => samples.push(sample));
  box().animate({ x: 100 }, { duration: 100 }).start();
  await settle();
  await assertAsleep(stage);
  assert.equal(samples.length, 0);
  const draws = surface.draws;
  await assertWakes(stage, () => renderer.setTelemetrySegment('detail'));
  await settle();
  assert.equal(samples.length, 1);
  assert.ok(
    samples[0].renderedFrames >= 6,
    'frames ' + samples[0].renderedFrames,
  );
  assert.equal(samples[0].fps, 60);
  assert.equal(surface.draws, draws);
  await assertAsleep(stage);
});

test('reprocessUpdates alone asks for no frame; its callback runs in the next one', async (t) => {
  const { stage, box } = await scene(t);
  const node = box();
  await settle();
  let ran = 0;
  await assertNoWake(() => stage.reprocessUpdates(() => ran++));
  assert.equal(ran, 0);
  await assertWakes(stage, () => {
    node.x = 10;
  });
  step();
  assert.equal(ran, 1);
  await settle();
  await assertAsleep(stage);
});

test('a timed node keeps the loop running only while it is renderable', async (t) => {
  const { stage, surface, box } = await scene(t);
  const node = box();
  await settle();
  await assertWakes(stage, () => {
    stage.trackTimedNode(node);
    stage.requestRender();
  });
  const draws = surface.draws;
  for (let i = 0; i < 5; i++) {
    step();
    assert.equal(frames.length, 1);
  }
  assert.equal(surface.draws, draws + 5);
  node.alpha = 0;
  await settle();
  await assertAsleep(stage);
  stage.untrackTimedNode(node);
});

test('work an idle listener asks for is not slept on', async (t) => {
  const { renderer, stage, seen, box } = await scene(t);
  const node = box();
  await settle();
  const idles = seen.idle;
  renderer.on('idle', () => {
    // A write, then an animation: neither wakes a loop that is awake.
    if (seen.idle === idles + 1) node.x = 50;
    if (seen.idle === idles + 2)
      node.animate({ y: 10 }, { duration: 50 }).start();
  });
  // An event queued while the tick's own events are being delivered.
  const custom = [];
  renderer.on('custom', (_, data) => {
    custom.push(data);
    if (data === 1) stage.queueFrameEvent('custom', 2);
  });
  node.x = 10;
  await settle();
  assert.equal(node.x, 50);
  assert.equal(node.y, 10);
  assert.equal(seen.idle, idles + 3);
  await assertWakes(stage, () => stage.queueFrameEvent('custom', 1));
  await settle();
  assert.deepEqual(custom, [1, 2]);
  await assertAsleep(stage);
});

test('a listener that throws costs one more tick, not a spinning loop', async (t) => {
  const errors = [];
  const { renderer, stage, seen, box } = await scene(t, {
    handleLoopError: (error) => errors.push(error.message),
  });
  const node = box();
  await settle();
  const idles = seen.idle;
  renderer.on('idle', () => {
    throw new Error('idle listener');
  });
  node.x = 10;
  await settle();
  assert.deepEqual(errors, ['idle listener']);
  assert.equal(seen.idle, idles + 1);
  await assertAsleep(stage);
  // A handler that rethrows does not stop the loop either.
  stage.options.handleLoopError = (error) => {
    throw error;
  };
  node.x = 20;
  step();
  assert.throws(() => step(), /idle listener/);
  assert.equal(frames.length, 1);
  await settle();
  await assertAsleep(stage);
  await assertWakes(stage, () => {
    node.x = 30;
  });
  step();
  assert.throws(() => step(), /idle listener/);
  await settle();
});

test('pausing a sleeping loop stops it at once, and resume draws what changed', async (t) => {
  const { renderer, stage, surface, box } = await scene(t);
  const node = box();
  await settle();
  await assertAsleep(stage);
  await assertNoWake(() => renderer.pause());
  assert.equal(renderer.isPaused, true);
  assert.equal(stage.loopAsleep, false);
  const draws = surface.draws;
  await assertNoWake(() => {
    node.x = 10;
    stage.requestRender();
    stage.queueFrameEvent('custom', 1);
    node.animate({ y: 100 }, { duration: 100 }).start();
  });
  await assertIdle();
  const before = requested;
  renderer.resume();
  // As a wake: one frame, and the fallback behind it.
  assert.equal(requested - before, 2);
  assert.deepEqual(pending(), [1, 1]);
  assert.equal(timers[0].ms, FALLBACK);
  assert.equal(renderer.isPaused, false);
  step();
  assert.equal(surface.draws, draws + 1);
  // The animation started while paused steps from where it was.
  assert.ok(node.y > 0 && node.y < 40, 'y after one step: ' + node.y);
  await settle();
  assert.equal(node.y, 100);
  await assertAsleep(stage);
});

test('a pause waits for a running animation, an immediate one does not', async (t) => {
  const { renderer, stage, box } = await scene(t);
  const node = box();
  await settle();
  node.animate({ x: 100 }, { duration: 100 }).start();
  step();
  renderer.pause();
  assert.equal(renderer.isPaused, false);
  await settle();
  assert.equal(node.x, 100);
  assert.equal(renderer.isPaused, true);
  await assertIdle();
  renderer.resume();
  await settle();
  await assertAsleep(stage);

  node.animate({ x: 0 }, { duration: 100 }).start();
  step();
  step();
  const x = node.x;
  renderer.pause({ immediate: true });
  await settle();
  assert.equal(renderer.isPaused, true);
  assert.equal(node.x, x);
  await assertIdle();
  renderer.resume();
  await settle();
  assert.equal(node.x, 0);
  await assertAsleep(stage);
});

test('a pause waiting on an animation that draws nothing still lands', async (t) => {
  const { renderer, stage, surface, box } = await scene(t);
  const node = box();
  await settle();
  // Same value throughout: the animation steps, and no tick has a frame.
  node.animate({ x: 0 }, { duration: 100 }).start();
  step();
  const draws = surface.draws;
  renderer.pause();
  assert.equal(renderer.isPaused, false);
  await settle();
  assert.equal(surface.draws, draws);
  assert.equal(renderer.isPaused, true);
  assert.equal(stage.loopAsleep, false);
  await assertIdle();
  renderer.resume();
  await settle();
  await assertAsleep(stage);
});

test('the frame cap holds a frame back with one timer, and none while idle', async (t) => {
  const { stage, surface, box } = await scene(t, { targetFPS: 30 });
  const node = box();
  await settle();
  await assertAsleep(stage);
  const draws = surface.draws;
  await assertWakes(stage, () => {
    node.x = 10;
  });
  // The wake frame draws at once: the cap counts from the last tick. Its
  // arrival clears the fallback, and the running loop arms no other.
  now += FRAME;
  deliver();
  assert.equal(surface.draws, draws + 1);
  assert.deepEqual(pending(), [1, 0]);
  // The next vsync is half a period early: the cap's one timer, then a frame.
  now += FRAME;
  deliver();
  assert.deepEqual(pending(), [0, 1]);
  const held = timers[0].ms;
  assert.ok(held > 0 && held < FRAME);
  wait(held);
  assert.deepEqual(pending(), [1, 0]);
  now += FRAME - held;
  deliver();
  assert.equal(surface.draws, draws + 1);
  await assertAsleep(stage);
});

test('nothing is scheduled after destroy', async (t) => {
  // Asleep.
  let made = await scene(t);
  let node = made.box();
  await settle();
  await assertNoWake(() => made.renderer.destroy());
  await assertNoWake(() => {
    node.x = 10;
    made.stage.requestRender();
    made.stage.queueFrameEvent('custom', 1);
    made.renderer.resume();
  });
  await assertIdle();

  // With a wake's frame and its fallback pending: both are taken back.
  made = await scene(t);
  node = made.box();
  assert.deepEqual(pending(), [1, 1]);
  await assertNoWake(() => made.renderer.destroy());
  assert.equal(made.renderer.isPaused, true);
  await assertIdle();

  // With a running loop's frame pending.
  made = await scene(t);
  node = made.box();
  step();
  assert.deepEqual(pending(), [1, 0]);
  await assertNoWake(() => made.renderer.destroy());
  await assertIdle();

  // During the frame cap's wait: its timer is taken back.
  made = await scene(t, { targetFPS: 30 });
  await assertAsleep(made.stage);
  node = made.box();
  step();
  now += FRAME;
  deliver();
  assert.deepEqual(pending(), [0, 1]);
  await assertNoWake(() => made.renderer.destroy());
  await assertIdle();

  // From a listener inside a tick: at its start, among the events a drawn
  // frame delivers, and in the tick that would have slept.
  for (const event of ['frameTick', 'custom', 'idle']) {
    made = await scene(t);
    node = made.box();
    await settle();
    const renderer = made.renderer;
    let atDestroy = -1;
    renderer.on(event, () => {
      renderer.destroy();
      atDestroy = requested;
    });
    node.x = 10;
    made.stage.queueFrameEvent('custom', 1);
    await settle();
    // Not even the tick it was called from asks for another.
    assert.equal(requested, atDestroy, event);
    assert.equal(renderer.isPaused, true, event);
    assert.equal(made.stage.loopAsleep, false);
    await assertNoWake(() => made.stage.requestRender());
    await assertIdle();
  }

  // From a listener that then throws: the catch asks for no retry.
  const errors = [];
  made = await scene(t, { handleLoopError: (error) => errors.push(error) });
  node = made.box();
  await settle();
  const renderer = made.renderer;
  renderer.on('idle', () => {
    renderer.destroy();
    throw new Error('after destroy');
  });
  node.x = 10;
  step();
  step();
  assert.equal(errors.length, 1);
  assert.equal(renderer.isPaused, true);
  await assertIdle();
});

test('a lost context ends the loop: nothing wakes it', async (t) => {
  let made = await scene(t);
  let node = made.box();
  await settle();
  made.stage.setContextLost();
  await assertNoWake(() => {
    node.x = 10;
    made.stage.requestRender();
  });
  await assertIdle();

  // With a wake's frame and its fallback pending: both are taken back.
  made = await scene(t);
  node = made.box();
  assert.deepEqual(pending(), [1, 1]);
  await assertNoWake(() => made.stage.setContextLost());
  await assertIdle();

  // Lost inside a tick, which is where a renderer finds out: that tick
  // requests nothing more.
  made = await scene(t);
  node = made.box();
  await settle();
  const stage = made.stage;
  made.renderer.on('frameTick', () => stage.setContextLost());
  node.x = 10;
  step();
  await assertIdle();
});

test('a wake arms one frame and one fallback timer, cleared when the frame arrives', async (t) => {
  const { stage, surface, box } = await scene(t);
  const node = box();
  await settle();
  await assertWakes(stage, () => {
    node.x = 10;
  });
  // More work before the frame comes requests and arms nothing more.
  await assertNoWake(() => {
    node.y = 10;
    stage.requestRender();
    stage.queueFrameEvent('custom', 1);
  });
  const draws = surface.draws;
  step();
  // The frame came: its timer is gone, and a running loop arms no other.
  assert.equal(surface.draws, draws + 1);
  assert.deepEqual(pending(), [1, 0]);
  step();
  assert.deepEqual(pending(), [0, 0]);
  // Nothing is left to fire once the delay has passed.
  await assertAsleep(stage);
  assert.equal(surface.draws, draws + 1);
});

test('if the frame never comes, the fallback runs the tick and the loop sleeps again', async (t) => {
  const { renderer, stage, surface, box } = await scene(t);
  const node = box();
  await settle();
  const got = [];
  renderer.on('custom', (_, data) => got.push(data));
  const draws = surface.draws;

  // A wake with one tick of work, an event to deliver.
  await assertWakes(stage, () => stage.queueFrameEvent('custom', 1));
  wait(FALLBACK - 1);
  assert.deepEqual(got, []);
  assert.deepEqual(pending(), [1, 1]);
  wait(1);
  // The timer ran the tick, once, and took the frame it stood in for back.
  assert.deepEqual(got, [1]);
  assert.equal(surface.draws, draws);
  assert.deepEqual(pending(), [0, 0]);
  await assertAsleep(stage);

  // A wake with a frame to draw takes two ticks: the draw, and the one the
  // burst settles on. The timer ran the first, so no animation frame is known
  // to be coming for the second either, and it gets a fallback of its own.
  await assertWakes(stage, () => {
    node.x = 10;
  });
  wait(FALLBACK);
  assert.equal(surface.draws, draws + 1);
  assert.deepEqual(pending(), [1, 1]);
  assert.equal(timers[0].ms, FALLBACK);
  wait(FALLBACK);
  assert.equal(surface.draws, draws + 1);
  assert.deepEqual(pending(), [0, 0]);
  await assertAsleep(stage);

  // Frames come back in the middle of a burst: the first to arrive clears
  // the timer, and from then on the loop arms none.
  const animation = node.animate({ x: 500 }, { duration: 200 });
  await assertWakes(stage, () => animation.start());
  wait(FALLBACK);
  assert.deepEqual(pending(), [1, 1]);
  step();
  assert.deepEqual(pending(), [1, 0]);
  step();
  assert.deepEqual(pending(), [1, 0]);
  await settle();
  assert.equal(node.x, 500);
  await assertAsleep(stage);
});

test('a pause while the fallback is pending leaves nothing scheduled', async (t) => {
  const { renderer, stage, surface, box } = await scene(t);
  const node = box();
  await settle();
  const draws = surface.draws;

  // Immediate: the frame and its fallback are taken back at once.
  await assertWakes(stage, () => {
    node.x = 10;
  });
  await assertNoWake(() => renderer.pause({ immediate: true }));
  assert.equal(renderer.isPaused, true);
  await assertIdle();
  assert.equal(surface.draws, draws);
  renderer.resume();
  assert.deepEqual(pending(), [1, 1]);
  await settle();
  assert.equal(surface.draws, draws + 1);
  await assertAsleep(stage);

  // Not immediate: the pending frame is still owed, so it and its fallback
  // stay until its tick has run. Where the frame never comes, the fallback
  // is what draws it and lands the pause.
  await assertWakes(stage, () => {
    node.x = 20;
  });
  await assertNoWake(() => renderer.pause());
  assert.equal(renderer.isPaused, false);
  assert.deepEqual(pending(), [1, 1]);
  wait(FALLBACK);
  assert.equal(surface.draws, draws + 2);
  assert.equal(renderer.isPaused, true);
  await assertIdle();
  renderer.resume();
  await settle();

  // Paused and resumed by a listener inside one tick: that tick carries on
  // and requests its next frame once.
  renderer.on('custom', () => {
    renderer.pause({ immediate: true });
    renderer.resume();
  });
  node.x = 30;
  stage.queueFrameEvent('custom', 1);
  step();
  assert.equal(renderer.isPaused, false);
  assert.deepEqual(pending(), [1, 0]);
  await settle();
  await assertAsleep(stage);
});

test('wakeFallbackDelay sets the delay, and 0 or a hidden page arms no timer', async (t) => {
  let made = await scene(t, { wakeFallbackDelay: 0 });
  let node = made.box();
  await settle();
  await assertWakes(
    made.stage,
    () => {
      node.x = 10;
    },
    0,
  );
  await settle();
  await assertAsleep(made.stage);

  made = await scene(t, { wakeFallbackDelay: 120 });
  node = made.box();
  await settle();
  await assertWakes(
    made.stage,
    () => {
      node.x = 10;
    },
    120,
  );
  await settle();

  // A hidden page's frames are held back on purpose: no timer stands in.
  made = await scene(t);
  node = made.box();
  await settle();
  t.after(() => {
    document.hidden = false;
  });
  document.hidden = true;
  await assertWakes(
    made.stage,
    () => {
      node.x = 10;
    },
    0,
  );
  document.hidden = false;
  await settle();

  // Hidden after the timer was armed: it fires and leaves the frame awaited.
  const draws = made.surface.draws;
  await assertWakes(made.stage, () => {
    node.x = 20;
  });
  document.hidden = true;
  wait(FALLBACK);
  assert.deepEqual(pending(), [1, 0]);
  assert.equal(made.surface.draws, draws);
  document.hidden = false;
  step();
  assert.equal(made.surface.draws, draws + 1);
  await settle();
  await assertAsleep(made.stage);
});
