import * as v from 'vitest';
import {
  captureThumbnail,
  configureMediaSession,
  createBookmarks,
  enterFullscreen,
  enterPictureInPicture,
  exitFullscreen,
} from '../src/sdk/media.js';
import { CapabilityError } from '../src/sdk/registry.js';
import {
  expectIdleWebProviders,
  expectSameTurn,
  forbid,
  provide,
  useWebServices,
  withoutServices,
} from './services-helpers.js';
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
  useWebServices();

  v.it(
    'publishes metadata, state, position and handlers, then cleans up',
    () => {
      const calls: string[] = [];
      provide({
        mediaSession: {
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
    },
  );

  v.it('the web provider drives navigator.mediaSession', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'mediaSession');
    const calls: string[] = [];
    const session = {
      metadata: undefined as unknown,
      playbackState: 'none',
      setPositionState(state: { position: number; duration: number }) {
        if (state.position > state.duration) throw new TypeError('invalid');
        calls.push(`position:${state.position}/${state.duration}`);
      },
      setActionHandler(action: string, handler: unknown) {
        if (action === 'seekto') throw new TypeError('unsupported');
        calls.push(`action:${action}:${handler ? 'set' : 'clear'}`);
      },
    };
    class FakeMetadata {
      constructor(public init: unknown) {}
    }
    v.vi.stubGlobal('MediaMetadata', FakeMetadata);
    try {
      // Older browsers have no media session: nothing happens.
      Object.defineProperty(navigator, 'mediaSession', {
        configurable: true,
        value: undefined,
      });
      configureMediaSession({ metadata: { title: 'x' } })();

      Object.defineProperty(navigator, 'mediaSession', {
        configurable: true,
        value: session,
      });
      const dispose = configureMediaSession({
        metadata: { title: 'Episode 1' },
        playbackState: 'playing',
        position: { duration: 600, position: 120 },
        actions: { pause: () => {}, seekto: () => {} },
      });
      v.expect((session.metadata as FakeMetadata).init).toEqual({
        title: 'Episode 1',
      });
      v.expect(session.playbackState).toBe('playing');
      v.expect(calls).toEqual(['position:120/600', 'action:pause:set']);
      dispose();
      v.expect(calls.slice(2)).toEqual(['action:pause:clear']);
      v.expect(session.playbackState).toBe('none');

      // A state update without metadata keeps what is published, and a
      // position the browser rejects is ignored.
      configureMediaSession({
        playbackState: 'paused',
        position: { duration: 1, position: 2 },
      });
      v.expect((session.metadata as FakeMetadata).init).toEqual({
        title: 'Episode 1',
      });
      v.expect(session.playbackState).toBe('paused');
    } finally {
      v.vi.unstubAllGlobals();
      if (original) Object.defineProperty(navigator, 'mediaSession', original);
      else delete (navigator as { mediaSession?: unknown }).mediaSession;
    }
  });

  v.it(
    'does nothing, and reads no browser API, without a media session service',
    async () => {
      const restore = forbid(navigator, 'mediaSession');
      try {
        await withoutServices(() => {
          const dispose = configureMediaSession({
            metadata: { title: 'Episode 1' },
            playbackState: 'playing',
            actions: { pause: () => {} },
          });
          dispose();
        });
      } finally {
        restore();
      }
    },
  );

  v.it(
    'the web provider is a plain object the registry reads synchronously',
    () => {
      expectIdleWebProviders({ eager: ['mediaSession'] });
    },
  );
});

v.describe('fullscreen and thumbnails', () => {
  useWebServices();

  v.it('uses the host fullscreen port for fullscreen and PiP', async () => {
    const calls: string[] = [];
    provide({
      fullscreen: {
        async enter(element) {
          calls.push(`enter:${String(element)}`);
        },
        async exit() {
          calls.push('exit');
        },
        async pictureInPicture(element) {
          calls.push(`pip:${String(element)}`);
        },
      },
    });
    await enterFullscreen('player');
    await exitFullscreen();
    await enterPictureInPicture('video');
    v.expect(calls).toEqual(['enter:player', 'exit', 'pip:video']);
  });

  v.it(
    'a host port without picture-in-picture reports it unavailable',
    async () => {
      provide({ fullscreen: { async enter() {}, async exit() {} } });
      await v.expect(enterPictureInPicture('video')).rejects.toMatchObject({
        name: 'CapabilityError',
        capability: 'pictureInPicture',
      });
    },
  );

  v.it(
    'the web provider uses the Fullscreen and Picture-in-Picture APIs',
    async () => {
      const calls: string[] = [];
      const root = document.documentElement as {
        requestFullscreen?: () => Promise<void>;
      };
      const page = document as { exitFullscreen?: () => Promise<void> };
      try {
        root.requestFullscreen = undefined;
        page.exitFullscreen = undefined;
        await v
          .expect(enterFullscreen())
          .rejects.toMatchObject({ capability: 'fullscreen' });
        await v.expect(exitFullscreen()).rejects.toThrowError(CapabilityError);
        await v
          .expect(enterPictureInPicture({}))
          .rejects.toMatchObject({ capability: 'pictureInPicture' });

        root.requestFullscreen = async () => void calls.push('enter:page');
        page.exitFullscreen = async () => void calls.push('exit');
        await enterFullscreen();
        await enterFullscreen({
          requestFullscreen: async () => void calls.push('enter:element'),
        });
        await exitFullscreen();
        await enterPictureInPicture({
          requestPictureInPicture: async () => void calls.push('pip'),
        });
        v.expect(calls).toEqual(['enter:page', 'enter:element', 'exit', 'pip']);
      } finally {
        delete root.requestFullscreen;
        delete page.exitFullscreen;
      }
    },
  );

  v.it('captures a thumbnail through the host port', async () => {
    const calls: string[] = [];
    provide({
      thumbnails: {
        async capture(source, time) {
          calls.push(`${source}:${time}`);
          return 'data:image/png;base64,thumb';
        },
      },
    });
    v.expect(await captureThumbnail('https://x.test/video.mp4', 12)).toBe(
      'data:image/png;base64,thumb',
    );
    v.expect(calls).toEqual(['https://x.test/video.mp4:12']);
  });

  v.it('the web provider draws a frame of a temporary video', async () => {
    const create = document.createElement.bind(document);
    const made: string[] = [];
    const spy = v.vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => {
        made.push(tag);
        if (tag === 'video') {
          const video = {
            videoWidth: 320,
            videoHeight: 180,
            set src(_value: string) {
              queueMicrotask(() => video.onloadeddata?.());
            },
            set currentTime(_value: number) {
              queueMicrotask(() => video.onseeked?.());
            },
            onloadeddata: undefined as (() => void) | undefined,
            onseeked: undefined as (() => void) | undefined,
          };
          return video as unknown as HTMLElement;
        }
        if (tag === 'canvas')
          return {
            getContext: () => ({ drawImage() {} }),
            toDataURL: (type: string) => `data:${type};base64,frame`,
          } as unknown as HTMLElement;
        return create(tag);
      });
    try {
      v.expect(await captureThumbnail('https://x.test/video.mp4', 3)).toBe(
        'data:image/png;base64,frame',
      );
      v.expect(made).toEqual(['video', 'canvas']);
    } finally {
      spy.mockRestore();
    }
  });

  v.it('a host without the services does not touch the page', async () => {
    const create = v.vi.spyOn(document, 'createElement');
    const restores = [
      forbid(document, 'documentElement'),
      forbid(document, 'exitFullscreen'),
    ];
    try {
      await withoutServices(async () => {
        await v
          .expect(enterFullscreen())
          .rejects.toMatchObject({ capability: 'fullscreen' });
        await v
          .expect(exitFullscreen())
          .rejects.toMatchObject({ capability: 'fullscreen' });
        await v
          .expect(
            enterPictureInPicture({
              requestPictureInPicture: () => {
                throw new Error('the element must not be asked');
              },
            }),
          )
          .rejects.toMatchObject({ capability: 'pictureInPicture' });
        await v.expect(captureThumbnail('x', 0)).rejects.toMatchObject({
          name: 'CapabilityError',
          capability: 'thumbnails',
        });
      });
      v.expect(create).not.toHaveBeenCalled();
    } finally {
      for (const restore of restores) restore();
      create.mockRestore();
    }
  });

  v.it(
    'fullscreen and picture-in-picture are requested in the same turn as the call',
    async () => {
      const root = document.documentElement as {
        requestFullscreen?: () => Promise<void>;
      };
      const page = document as { exitFullscreen?: () => Promise<void> };
      const enterPage = v.vi.fn(async () => {});
      const enterElement = v.vi.fn(async () => {});
      const exit = v.vi.fn(async () => {});
      const pip = v.vi.fn(async () => {});
      root.requestFullscreen = enterPage;
      page.exitFullscreen = exit;
      try {
        await expectSameTurn(enterPage, () => enterFullscreen());
        await expectSameTurn(enterElement, () =>
          enterFullscreen({ requestFullscreen: enterElement }),
        );
        await expectSameTurn(exit, () => exitFullscreen());
        await expectSameTurn(pip, () =>
          enterPictureInPicture({ requestPictureInPicture: pip }),
        );
      } finally {
        delete root.requestFullscreen;
        delete page.exitFullscreen;
      }
    },
  );

  v.it('the web providers are installed without doing any work', () => {
    expectIdleWebProviders({ lazy: ['thumbnails'], eager: ['fullscreen'] });
  });
});
