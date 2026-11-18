import * as v from 'vitest';
import {
  createAudioPlayer,
  setAudioPort,
  type AudioPort,
} from '../src/sdk/audio.js';
import {
  mediaCapabilities,
  setMediaCapabilitiesPort,
  supportsDrm,
} from '../src/sdk/drm.js';

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
  v.afterEach(() => setAudioPort(undefined));

  v.it('drives a host audio port and tracks state', async () => {
    const { port, calls } = fakePort();
    setAudioPort(port);
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
});

v.describe('DRM capabilities', () => {
  v.afterEach(() => setMediaCapabilitiesPort(undefined));

  v.it('reports host codecs, DRM and HDR', async () => {
    setMediaCapabilitiesPort({
      async get() {
        return {
          drm: ['com.widevine.alpha'],
          codecs: ['video/mp4; codecs="avc1.42E01E"'],
          hdr: true,
        };
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
});
