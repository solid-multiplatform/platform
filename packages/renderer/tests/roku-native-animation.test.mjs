// A host that supplies native animations: the JS clock must not run for the
// properties it took, the controller keeps the contract's semantics, and a
// property it refuses falls back to the JavaScript animation.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';

const sdk = new URL('./fakes/roku-sdk.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@roku-sdk/solid' || specifier === '@roku-sdk/rsg-ts/runtime') {
      return { url: sdk, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { createElement } = await import(sdk);
const { SceneGraphRenderer, CompositorAnimation } = await import('../dist/roku/index.js');

const realTimeout = globalThis.setTimeout;
const sleep = (ms) => new Promise((resolve) => realTimeout(resolve, ms));

/** A host whose native animations report through `sinks`. */
function nativeHost() {
  const sinks = [];
  const host = {
    createNativeAnimation(node, key, target, settings) {
      // Only x/y/alpha on a motion root, and only without loop bookkeeping:
      // the same gate the Roku host applies.
      if (!node.nativeMotionRoot) return undefined;
      if (key !== 'x' && key !== 'y' && key !== 'alpha') return undefined;
      if (settings.loop || settings.repeat || settings.delay) return undefined;
      const sink = {
        key,
        calls: [],
        serial: 0,
        reply: null,
        disposed: false,
        prepare() {},
        send(action, serial, to, duration) {
          this.serial = serial;
          this.calls.push({ action, to, duration });
          if (action === 'start') node.holdNativeMotion(key);
          this.reply = arguments[5];
        },
        dispose() {
          this.disposed = true;
          node.releaseNativeMotion(key);
        },
      };
      sinks.push(sink);
      return new CompositorAnimation(
        key === 'alpha' ? node.alpha : node[key],
        target,
        settings.duration ?? 0,
        'linear',
        (value) => {
          node[key] = value;
          node.requestRender();
        },
        sink,
      );
    },
  };
  return { host, sinks };
}

function scene(t, host = nativeHost().host) {
  const renderer = new SceneGraphRenderer({}, createElement('group'), host);
  t.after(() => renderer.destroy());
  return renderer;
}

test('a native property runs without a JS frame timer', async (t) => {
  const { host, sinks } = nativeHost();
  const renderer = scene(t, host);
  const node = renderer.createNode({ x: 10, y: 20, w: 40, h: 40, color: 0xff0000ff, parent: renderer.root });
  renderer.flush();

  let armed = 0;
  globalThis.setTimeout = (...args) => {
    armed++;
    return realTimeout(...args);
  };
  try {
    const controller = node.animateProp('x', 90, { duration: 1000, easing: 'linear' });
    await sleep(30);
    assert.equal(controller.state, 'running');
    assert.equal(armed, 0, 'the JS clock armed a timer for a native animation');
    assert.equal(renderer.animator.running, false, 'the animator thinks a JS animation is running');
    assert.deepEqual(sinks.map((sink) => [sink.key, sink.calls[0].action, sink.calls[0].duration]), [['x', 'start', 1000]]);
    assert.equal(node.nativeMotionOwned?.has('x'), true, 'the render thread does not own the property');
    // The JS value stays at the start until the render thread reports the end.
    assert.equal(node.x, 10);
  } finally {
    globalThis.setTimeout = realTimeout;
  }

  const sink = sinks[0];
  sink.reply({ serial: sink.serial, state: 'stopped', value: 90 });
  assert.equal(node.x, 90);
  assert.equal(renderer.animator.running, false);
  assert.equal(sink.disposed, false);
});

test('stop, pause, resume and restore reach the sink', async (t) => {
  const { host, sinks } = nativeHost();
  const renderer = scene(t, host);
  const node = renderer.createNode({ x: 0, y: 0, w: 20, h: 20, parent: renderer.root });
  renderer.flush();

  const controller = node.animateProp('alpha', 0, { duration: 500 });
  const sink = sinks[0];
  controller.pause();
  assert.equal(controller.state, 'paused');
  assert.equal(sink.calls.at(-1).action, 'pause');
  controller.start();
  assert.equal(sink.calls.at(-1).action, 'resume');
  sink.reply({ serial: sink.serial, state: 'paused', value: 0.75 });
  assert.equal(node.alpha, 0.75, 'a paused value is published');

  controller.stop();
  assert.equal(controller.state, 'stopped');
  assert.equal(sink.calls.at(-1).action, 'stop');

  // restore goes back to the value the run started from, at once.
  const second = node.animateProp('alpha', 0.2, { duration: 500 });
  const restoreSink = sinks.at(-1);
  second.restore();
  assert.equal(node.alpha, 0.75);
  assert.equal(restoreSink.calls.at(-1).action, 'start');
  assert.equal(restoreSink.calls.at(-1).duration, 0);
  assert.equal(second.state, 'stopped');
});

test('a property the host refuses falls back to the JS clock', async (t) => {
  const { host, sinks } = nativeHost();
  const renderer = scene(t, host);
  const node = renderer.createNode({ x: 0, y: 0, w: 20, h: 20, parent: renderer.root });
  renderer.flush();

  const controller = node.animateProp('scale', 2, { duration: 20, easing: 'linear' });
  assert.equal(sinks.length, 0, 'scale was handed to the render thread');
  assert.equal(renderer.animator.running, true, 'the JS animator did not take the fallback');
  await controller.waitUntilStopped();
  assert.equal(node.scaleX, 2);
  assert.equal(renderer.animator.running, false);
});

test('a loop stays on the JS clock', async (t) => {
  const { host, sinks } = nativeHost();
  const renderer = scene(t, host);
  const node = renderer.createNode({ x: 0, y: 0, w: 20, h: 20, parent: renderer.root });
  renderer.flush();

  const controller = node.animateProp('x', 10, { duration: 5, loop: true });
  assert.equal(sinks.length, 0, 'a looping animation was handed to the render thread');
  assert.equal(renderer.animator.running, true);
  controller.stop();
  assert.equal(controller.state, 'stopped');
});
