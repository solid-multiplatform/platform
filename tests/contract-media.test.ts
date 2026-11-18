import * as v from 'vitest';
import {
  captureThumbnail,
  configureMediaSession,
  createBookmarks,
  enterFullscreen,
  enterPictureInPicture,
  exitFullscreen,
  setFullscreenPort,
  setMediaSessionPort,
  setThumbnailPort,
} from '../src/sdk/media.js';
import type { Store } from '../src/sdk/services.js';

const memoryStore = (
  seed: Record<string, string> = {},
): Store & {
  map: Map<string, string>;
} => {
  const map = new Map(Object.entries(seed));
  return {
    map,
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => {
      map.set(key, value);
    },
    remove: async (key) => {
      map.delete(key);
    },
  };
};

v.describe('media bookmarks', () => {
  v.it('saves, restores and clears playback positions', async () => {
    const storage = memoryStore();
    const bookmarks = createBookmarks({ storage });
    await bookmarks.hydrate();
    v.expect(bookmarks.ready()).toBe(true);
    await bookmarks.save('episode-1', 120, 600);
    v.expect(bookmarks.get('episode-1')).toMatchObject({
      position: 120,
      duration: 600,
    });
    v.expect(JSON.parse(storage.map.get('media-bookmarks')!)).toHaveProperty(
      'episode-1.position',
      120,
    );
    v.expect(bookmarks.resume('episode-1')).toBe(120);
    bookmarks.dispose();
  });

  v.it('restarts near the beginning or the end', async () => {
    const bookmarks = createBookmarks({ storage: memoryStore() });
    await bookmarks.hydrate();
    await bookmarks.save('a', 3, 600);
    v.expect(bookmarks.resume('a')).toBe(0);
    await bookmarks.save('b', 595, 600);
    v.expect(bookmarks.resume('b')).toBe(0);
    await bookmarks.save('c', 595, 600);
    v.expect(bookmarks.resume('c', { endTolerance: 2 })).toBe(595);
    v.expect(bookmarks.resume('missing')).toBe(0);
    bookmarks.dispose();
  });

  v.it('hydrates persisted positions and clears them', async () => {
    const storage = memoryStore({
      'media-bookmarks': JSON.stringify({
        movie: { position: 42, duration: 100, updated: 1 },
      }),
    });
    const bookmarks = createBookmarks({ storage });
    await bookmarks.hydrate();
    v.expect(bookmarks.resume('movie')).toBe(42);
    await bookmarks.clear('movie');
    v.expect(bookmarks.get('movie')).toBeUndefined();
    v.expect(JSON.parse(storage.map.get('media-bookmarks')!)).toEqual({});
    bookmarks.dispose();
  });
});

v.describe('media session', () => {
  v.it(
    'publishes metadata, state, position and handlers, then cleans up',
    () => {
      const calls: string[] = [];
      setMediaSessionPort({
        setMetadata(metadata) {
          calls.push(`metadata:${metadata.title}`);
        },
        setPlaybackState(state) {
          calls.push(`state:${state}`);
        },
        setPositionState(state) {
          calls.push(`position:${state.position}/${state.duration}`);
        },
        setActionHandler(action, handler) {
          calls.push(`action:${action}:${handler ? 'set' : 'clear'}`);
        },
      });
      const dispose = configureMediaSession({
        metadata: { title: 'Episode 1', artist: 'Solid' },
        playbackState: 'playing',
        position: { duration: 600, position: 120 },
        actions: { pause: () => {}, nexttrack: () => {} },
      });
      v.expect(calls).toEqual([
        'metadata:Episode 1',
        'state:playing',
        'position:120/600',
        'action:pause:set',
        'action:nexttrack:set',
      ]);
      dispose();
      v.expect(calls.slice(5)).toEqual([
        'action:pause:clear',
        'action:nexttrack:clear',
        'state:none',
      ]);
      setMediaSessionPort(undefined);
    },
  );
});

v.describe('fullscreen and thumbnails', () => {
  v.afterEach(() => {
    setFullscreenPort(undefined);
    setThumbnailPort(undefined);
  });

  v.it('uses the host fullscreen port for fullscreen and PiP', async () => {
    const calls: string[] = [];
    setFullscreenPort({
      async enter(element) {
        calls.push(`enter:${String(element)}`);
      },
      async exit() {
        calls.push('exit');
      },
      async pictureInPicture(element) {
        calls.push(`pip:${String(element)}`);
      },
    });
    await enterFullscreen('player');
    await exitFullscreen();
    await enterPictureInPicture('video');
    v.expect(calls).toEqual(['enter:player', 'exit', 'pip:video']);
  });

  v.it('captures a thumbnail through the host port', async () => {
    const calls: string[] = [];
    setThumbnailPort({
      async capture(source, time) {
        calls.push(`${source}:${time}`);
        return 'data:image/png;base64,thumb';
      },
    });
    v.expect(await captureThumbnail('https://x.test/video.mp4', 12)).toBe(
      'data:image/png;base64,thumb',
    );
    v.expect(calls).toEqual(['https://x.test/video.mp4:12']);
  });
});
