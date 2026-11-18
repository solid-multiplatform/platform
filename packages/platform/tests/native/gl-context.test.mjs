import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeContext } from '../../hosts/android-tv/gl-context.mjs';

test('the first context request does not silently enable MSAA or unused buffers', () => {
  const calls = [], gl = {};
  const result = createNativeContext({ getContext(type, attrs) { calls.push([type, attrs]); return gl; } });
  assert.equal(result.gl, gl); assert.equal(result.webgl2, true);
  assert.equal(calls.length, 1);
  for (const option of ['antialias', 'depth', 'stencil', 'preserveDrawingBuffer']) assert.equal(calls[0][1][option], false);
});
test('WebGL1 fallback keeps the same attributes and an absent GPU fails visibly', () => {
  const calls = [], gl = {};
  const result = createNativeContext({ getContext(type, attrs) { calls.push(attrs); return type === 'webgl' ? gl : null; } });
  assert.equal(result.webgl2, false); assert.equal(calls[0], calls[1]);
  assert.throws(() => createNativeContext({ getContext: () => null }), /no usable/);
});
