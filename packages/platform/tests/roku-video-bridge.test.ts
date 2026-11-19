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
    v.expect(calls).toHaveLength(1);
    const [root_, options] = calls[0] as [
      object,
      {
        x: number;
        y: number;
        width: number;
        height: number;
        mediaSession?: unknown;
      },
    ];
    v.expect(root_).toBe(root);
    v.expect(options).toMatchObject({
      x: 10,
      y: 20,
      width: 1280,
      height: 720,
    });
    // The host's media-session service is handed to the adapter when present;
    // this suite installs no services, so it is undefined here.
    v.expect('mediaSession' in options).toBe(true);
  });

  v.it('is absent when the app has no video adapter', () => {
    v.expect(createRokuVideoApi({})).toBeUndefined();
  });
});
