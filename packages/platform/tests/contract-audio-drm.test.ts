import * as v from 'vitest';
import { createAudioPlayer, type AudioPort } from '../src/sdk/audio.js';
import { mediaCapabilities, supportsDrm } from '../src/sdk/drm.js';
import { CapabilityError } from '../src/sdk/registry.js';
import { webServices } from '../src/hosts/web-services/index.js';
import {
  expectIdleWebProviders,
  expectSameTurn,
  forbid,
  provide,
  useWebServices,
  withoutServices,
} from './services-helpers.js';

const track = { id: 't1', url: 'https://x.test/a.mp3', title: 'A' };

const fakePort = () => {
  const calls: string[] = [];
  const port: AudioPort = {
    async play(t, options) {
      calls.push(
        `play:${t.id}:${options?.position ?? 0}:${options?.volume ?? 1}`,
      );
    },
    async pause() {
      calls.push('pause');
    },
    async resume() {
      calls.push('resume');
    },
    async stop() {
      calls.push('stop');
    },
    async seek(position) {
      calls.push(`seek:${position}`);
    },
    setVolume(volume) {
      calls.push(`volume:${volume}`);
    },
  };
  return { port, calls };
};

v.describe('audio player', () => {
  useWebServices();

  v.it('drives a host audio port and tracks state', async () => {
    const { port, calls } = fakePort();
    provide({ audio: port });
    const player = createAudioPlayer({ volume: 0.5 });
    v.expect(player.track()).toBeUndefined();
    v.expect(player.playing()).toBe(false);
    v.expect(player.volume()).toBe(0.5);

    await player.play(track, { position: 12 });
    v.expect(calls).toEqual(['play:t1:12:0.5']);
    v.expect(player.track()).toBe(track);
    v.expect(player.playing()).toBe(true);

    await player.pause();
    await player.resume();
    await player.seek(30);
    player.setVolume(2);
    player.setVolume(-1);
    v.expect(calls).toEqual([
      'play:t1:12:0.5',
      'pause',
      'resume',
      'seek:30',
      'volume:1',
      'volume:0',
    ]);
    v.expect(player.volume()).toBe(0);

    await player.stop();
    v.expect(player.playing()).toBe(false);
    v.expect(player.track()).toBeUndefined();
  });

  v.it(
    'prefers a port passed to the player over the host service',
    async () => {
      const host = fakePort();
      const own = fakePort();
      provide({ audio: host.port });
      const player = createAudioPlayer({ port: own.port });
      await player.play(track);
      player.setVolume(0.25);
      v.expect(own.calls).toEqual(['play:t1:0:1', 'volume:0.25']);
      v.expect(host.calls).toEqual([]);
    },
  );

  v.it(
    'calls a port that is already there in the same turn as the app',
    async () => {
      // Playback starts only inside the user's gesture on most browsers.
      const play = v.vi.fn(async () => {});
      provide({ audio: { ...fakePort().port, play } });
      const player = createAudioPlayer();
      await expectSameTurn(play, () => player.play(track));
      const own = v.vi.fn(async () => {});
      const withOwnPort = createAudioPlayer({
        port: { ...fakePort().port, play: own },
      });
      await expectSameTurn(own, () => withOwnPort.play(track));
    },
  );

  v.it('the web provider drives one audio element', async () => {
    const elements: FakeAudio[] = [];
    class FakeAudio {
      src = '';
      preload = '';
      volume = 1;
      currentTime = 0;
      calls: string[] = [];
      constructor() {
        elements.push(this);
      }
      async play() {
        this.calls.push('play');
      }
      pause() {
        this.calls.push('pause');
      }
      load() {
        this.calls.push('load');
      }
      removeAttribute(name: string) {
        this.calls.push(`remove:${name}`);
      }
    }
    v.vi.stubGlobal('Audio', FakeAudio);
    try {
      // One provider per install: a fresh layer gives this test its own port.
      provide({ audio: webServices.audio });
      const player = createAudioPlayer({ volume: 0.5 });
      // Before the first play there is no element to set the volume on.
      player.setVolume(0.4);
      v.expect(elements).toHaveLength(0);
      await player.play(track, { position: 12 });
      v.expect(elements).toHaveLength(1);
      const element = elements[0]!;
      v.expect([element.src, element.volume, element.currentTime]).toEqual([
        track.url,
        0.4,
        12,
      ]);
      await player.pause();
      await player.resume();
      await player.seek(30);
      player.setVolume(0.2);
      v.expect(element.currentTime).toBe(30);
      v.expect(element.volume).toBe(0.2);
      await player.stop();
      // Every call reached the one element the first play created.
      v.expect(elements).toHaveLength(1);
      v.expect(element.calls).toEqual([
        'play',
        'pause',
        'play',
        'pause',
        'remove:src',
        'load',
      ]);
    } finally {
      v.vi.unstubAllGlobals();
    }
  });

  v.it(
    'a host without an audio service cannot play and builds no element',
    async () => {
      const restore = forbid(globalThis, 'Audio');
      try {
        await withoutServices(async () => {
          const player = createAudioPlayer();
          await v.expect(player.play(track)).rejects.toMatchObject({
            name: 'CapabilityError',
            capability: 'audio',
          });
          await v.expect(player.pause()).rejects.toThrowError(CapabilityError);
          v.expect(() => player.setVolume(0.5)).toThrowError(CapabilityError);
          v.expect(player.playing()).toBe(false);
          v.expect(player.track()).toBeUndefined();
        });
      } finally {
        restore();
      }
    },
  );

  v.it('the web provider is installed without doing any work', () => {
    expectIdleWebProviders({ eager: ['audio'] });
  });
});

v.describe('DRM capabilities', () => {
  useWebServices();

  v.it('reports host codecs, DRM and HDR', async () => {
    provide({
      mediaCapabilities: {
        async get() {
          return {
            drm: ['com.widevine.alpha'],
            codecs: ['video/mp4; codecs="avc1.42E01E"'],
            hdr: true,
          };
        },
      },
    });
    v.expect(await mediaCapabilities()).toEqual({
      drm: ['com.widevine.alpha'],
      codecs: ['video/mp4; codecs="avc1.42E01E"'],
      hdr: true,
    });
    v.expect(await supportsDrm('com.widevine.alpha')).toBe(true);
    v.expect(await supportsDrm('com.apple.fps')).toBe(false);
  });

  v.it(
    'the web provider probes key systems, Media Source and the display',
    async () => {
      const probed: string[] = [];
      const original = Object.getOwnPropertyDescriptor(
        navigator,
        'requestMediaKeySystemAccess',
      );
      Object.defineProperty(navigator, 'requestMediaKeySystemAccess', {
        configurable: true,
        value: async (scheme: string) => {
          probed.push(scheme);
          if (scheme !== 'com.widevine.alpha') throw new Error('unsupported');
        },
      });
      v.vi.stubGlobal('MediaSource', {
        isTypeSupported: (codec: string) => codec.startsWith('video/mp4'),
      });
      v.vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query === '(dynamic-range: high)',
      }));
      try {
        v.expect(await mediaCapabilities()).toEqual({
          drm: ['com.widevine.alpha'],
          codecs: ['video/mp4; codecs="avc1.42E01E"'],
          hdr: true,
        });
        v.expect(probed).toEqual([
          'com.widevine.alpha',
          'com.apple.fps',
          'com.microsoft.playready',
        ]);
        v.expect(await supportsDrm('com.apple.fps')).toBe(false);
      } finally {
        v.vi.unstubAllGlobals();
        if (original)
          Object.defineProperty(
            navigator,
            'requestMediaKeySystemAccess',
            original,
          );
        else
          delete (navigator as { requestMediaKeySystemAccess?: unknown })
            .requestMediaKeySystemAccess;
      }
    },
  );

  v.it(
    'a host without the service cannot tell, and probes no browser API',
    async () => {
      const restores = [
        forbid(navigator, 'requestMediaKeySystemAccess'),
        forbid(globalThis, 'MediaSource'),
        forbid(globalThis, 'matchMedia'),
      ];
      try {
        await withoutServices(async () => {
          await v.expect(mediaCapabilities()).rejects.toMatchObject({
            name: 'CapabilityError',
            capability: 'mediaCapabilities',
          });
          await v
            .expect(supportsDrm('com.widevine.alpha'))
            .rejects.toThrowError(CapabilityError);
        });
      } finally {
        for (const restore of restores) restore();
      }
    },
  );

  v.it('the web provider is installed without doing any work', () => {
    expectIdleWebProviders({ lazy: ['mediaCapabilities'] });
  });
});
