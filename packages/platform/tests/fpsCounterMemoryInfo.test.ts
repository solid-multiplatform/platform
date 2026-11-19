// setupFPS reads renderer.memoryInfo(), which the scene contract marks
// optional: a backend without it must not make the fpsUpdate listener throw.
import * as v from 'vitest';
import './setup.js';
import { setupFPS } from '@solid-multiplatform/platform/primitives';

type Listener = (target: unknown, data: unknown) => void;

function fakeRoot() {
  const listeners: Record<string, Listener> = {};
  return {
    listeners,
    root: {
      renderer: {
        on(event: string, listener: Listener) {
          listeners[event] = listener;
        },
      },
    },
  };
}

v.describe('setupFPS', () => {
  v.test('a renderer without memoryInfo does not throw on fpsUpdate', () => {
    const { root, listeners } = fakeRoot();
    setupFPS(root);
    v.expect(() => listeners.fpsUpdate!({}, { fps: 60 })).not.toThrow();
  });

  v.test('a renderer with memoryInfo is read', () => {
    const { root, listeners } = fakeRoot();
    setupFPS(root);
    const memoryInfo = v.vi.fn(() => ({
      criticalThreshold: 0,
      targetThreshold: 0,
      renderableMemUsed: 0,
      memUsed: 0,
      renderableTexturesLoaded: 0,
      loadedTextures: 0,
    }));
    // The listener samples memory once every 10 updates.
    for (let i = 0; i < 10; i++) listeners.fpsUpdate!({ memoryInfo }, 60);
    v.expect(memoryInfo).toHaveBeenCalledTimes(1);
  });
});
