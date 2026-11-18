import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { decodeImageBlob } from '../dist/webgl/src/core/textures/ImageWorker.js';
import { CoreNode } from '../dist/canvas/src/core/CoreNode.js';
import { CoreTextNode } from '../dist/canvas/src/core/CoreTextNode.js';
import { CoreTextureManager } from '../dist/canvas/src/core/CoreTextureManager.js';
import { TextureType } from '../dist/canvas/src/core/textures/Texture.js';

test('timed-out decodes close a late bitmap in both main and serialized worker code', async () => {
  for (const decode of [decodeImageBlob, Function('return (' + decodeImageBlob.toString() + ')')()]) {
    let finish;
    let closed = false;
    const pending = new Promise(resolve => { finish = resolve; });
    await assert.rejects(decode(() => pending, null, new Blob(), false, null, null, null, null, false, false, null, 1), { name: 'ImageBitmapTimeoutError' });
    finish({ close() { closed = true; } });
    await pending;
    assert.equal(closed, true);
  }
});

test('replacing a property animation stops its old controller', () => {
  const running = new Set();
  const target = { x: 0, _animations: null, stage: { animationManager: {
    registerAnimation: controller => running.add(controller),
    unregisterAnimation: controller => running.delete(controller),
  } } };
  const old = CoreNode.prototype.animateProp.call(target, 'x', 200, { duration: 500 });
  const next = CoreNode.prototype.animateProp.call(target, 'x', 0, { duration: 0 });
  assert.equal(running.has(old), false);
  assert.equal(target._animations.x.controller, next);
  assert.equal(old.state, 'stopped');
});

test('Canvas retains displayed text while replacing and retiring pending textures', () => {
  const pending = [];
  const initial = {};
  const label = { _type: 'canvas', _id: 1, textureLoaded: true, texture: initial,
    stage: { requestRender() {}, txManager: { createTexture() {
      const texture = Object.assign(new EventEmitter(), { owned: false,
        setRenderableOwner(_id, owned) { this.owned = owned; } });
      pending.push(texture);
      return texture;
    } } },
    setRenderable() {}, finishTextRender() {},
    cancelPendingCanvas: CoreTextNode.prototype.cancelPendingCanvas,
  };
  const render = value => CoreTextNode.prototype.handleRenderResult.call(label, value);
  render({ imageData: {} });
  render({ imageData: {} });
  assert.equal(label.texture, initial);
  assert.equal(pending[0].owned, false);
  assert.equal(pending[0].listenerCount('loaded'), 0);
  assert.equal(pending[1].owned, true);
  pending[1].emit('loaded');
  assert.equal(label.texture, pending[1]);
  assert.equal(pending[1].owned, false);
  render({});
  assert.equal(label.texture, null);
});

test('decoded Canvas pixels upload synchronously before decoder initialization', async t => {
  class Pixels {}
  const original = Object.getOwnPropertyDescriptor(globalThis, 'ImageData');
  Object.defineProperty(globalThis, 'ImageData', { value: Pixels, configurable: true });
  t.after(() => original ? Object.defineProperty(globalThis, 'ImageData', original) : delete globalThis.ImageData);
  const pixels = new Pixels();
  let uploaded;
  const manager = { pendingLoads: 0, initialized: false, renderer: { mode: 'canvas' },
    uploadTexture(texture) { uploaded = texture.textureData; } };
  const image = { props: { src: pixels, premultiplyAlpha: false }, type: TextureType.image,
    setState(state) { this.state = state; } };
  const done = CoreTextureManager.prototype.loadTexture.call(manager, image);
  assert.deepEqual(uploaded, { data: pixels, premultiplyAlpha: false });
  await done;
  assert.equal(manager.pendingLoads, 0);
});
