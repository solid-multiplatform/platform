import * as v from 'vitest';
import { createRokuVideoApi } from '../hosts/roku/video-bridge.js';

v.describe('Roku video host bridge', () => {
  v.it('passes the scene root and options to the app adapter', () => {
    const calls: unknown[] = [];
    const root = { type: 'group' };
    const api = createRokuVideoApi(root, (parent, options) => {
      calls.push([parent, options]);
      return { player: true };
    })!;
    v.expect(api.create({ x: 10, y: 20, width: 1280, height: 720 })).toEqual({
      player: true,
    });
    v.expect(calls).toEqual([
      [root, { x: 10, y: 20, width: 1280, height: 720 }],
    ]);
  });

  v.it('is absent when the app has no video adapter', () => {
    v.expect(createRokuVideoApi({})).toBeUndefined();
  });
});
