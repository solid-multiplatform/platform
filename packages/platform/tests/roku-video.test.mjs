import * as v from 'vitest';
import {
  createRokuPlayer,
  rokuMediaCapabilities,
  rokuPlaybackCapabilities,
  rokuStreamFormat,
} from '../../video/roku.mjs';

const root = () => ({ type: 'group', children: [], props: {} });

function fakeHost(features) {
  const listeners = new Set();
  const sent = [];
  let unsubscribed = false;
  return {
    sent,
    mediaSession: undefined,
    send(command) {
      sent.push(JSON.parse(command));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        unsubscribed = true;
        listeners.delete(listener);
      };
    },
    emit(event) {
      for (const listener of Array.from(listeners)) listener(event);
    },
    features: () => features,
    get unsubscribed() {
      return unsubscribed;
    },
  };
}

v.afterEach(() => {
  delete globalThis.__smpRokuVideoHost;
});

v.describe('Roku video adapter', () => {
  v.it('creates its own Video layer under the scene tree, never above it', async () => {
    const scene = root();
    const ui = { type: 'group', children: [], props: {} };
    scene.children.push(ui);
    const player = createRokuPlayer(scene, { width: 1280, height: 720 });
    v.expect(player.capabilities.canSelectAudioTrack).toBe(true);
    v.expect(player.capabilities.canSelectTextTrack).toBe(true);
    v.expect(player.capabilities.directNative).toBe('supported');

    await player.open({
      url: 'https://example.test/movie.m3u8',
      kind: 'vod',
      paused: true,
    });
    // The Video is the first child, before the renderer's UI tree.
    v.expect(scene.children).toHaveLength(2);
    const video = scene.children[0];
    v.expect(video.type).toBe('video');
    v.expect(scene.children[1]).toBe(ui);
    v.expect(video.props.width).toBe(1280);
    v.expect(video.props.height).toBe(720);
    v.expect(video.props.enableUI).toBe(false);
    v.expect(video.props.notificationInterval).toBe(1);
    v.expect(video.props.control).toBe('pause');
    v.expect(player.snapshot.state).toBe('paused');

    player.dispose();
    v.expect(scene.children).toEqual([ui]);
  });

  v.it('tracks state, position, duration, tracks, seeking and errors', async () => {
    const scene = root();
    const player = createRokuPlayer(scene);
    await player.open({
      url: 'https://example.test/movie.m3u8',
      kind: 'vod',
    });
    const video = scene.children[0];

    video.props.onState('playing');
    v.expect(player.snapshot.state).toBe('playing');
    video.props.onPosition(3.5);
    video.props.onDuration(42);
    v.expect(player.snapshot.time).toMatchObject({
      positionSeconds: 3.5,
      durationSeconds: 42,
    });

    video.props.onAvailableAudioTracks([
      { Track: 'a1', Description: 'English', Language: 'en' },
    ]);
    video.props.onAvailableSubtitleTracks([
      { TrackName: 't1', Description: 'English CC', Language: 'en' },
    ]);
    v.expect(player.snapshot.tracks.audio[0]).toMatchObject({
      id: 'a1',
      label: 'English',
    });
    v.expect(player.snapshot.tracks.text[0]).toMatchObject({
      id: 't1',
      label: 'English CC',
    });
    await player.selectAudioTrack('a1');
    await player.selectTextTrack('t1');
    v.expect(video.props.audioTrack).toBe('a1');
    v.expect(video.props.subtitleTrack).toBe('t1');
    await player.selectTextTrack(null);
    v.expect(video.props.subtitleTrack).toBe('off');
    await v
      .expect(player.selectAudioTrack('missing'))
      .rejects.toThrowError(/Track unavailable/);

    await player.seek(30);
    v.expect(video.props.seek).toBe(30);
    await player.setPictureMode('fill');
    v.expect(video.props.scaleMode).toBe('zoomToFill');
    await player.fastForward(4);
    v.expect(video.props.trickPlaySpeed).toBe(4);
    await player.rewind(2);
    v.expect(video.props.trickPlaySpeed).toBe(-2);

    video.props.onState('finished');
    v.expect(player.snapshot.state).toBe('ended');

    video.props.onErrorCode(403);
    video.props.onErrorMsg('Forbidden by the origin');
    video.props.onState('error');
    v.expect(player.snapshot.state).toBe('error');
    v.expect(player.snapshot.error.code).toBe('authorization-failed');
    v.expect(player.snapshot.error.cause).toMatchObject({
      firmwareCode: 403,
      firmwareMessage: 'Forbidden by the origin',
    });
    v.expect(player.snapshot.error.message).toContain('Roku error 403');

    player.dispose();
    v.expect(video.props.onState).toBeUndefined();
    v.expect(video.props.onPosition).toBeUndefined();
  });

  v.it('opens paused with a start position and never stacks over the UI', async () => {
    const scene = root();
    const player = createRokuPlayer(scene, { x: 10, y: 20 });
    await player.open({
      url: 'https://example.test/movie.mp4',
      kind: 'vod',
      paused: true,
      startAtSeconds: 12,
      timelineOffsetSeconds: 0,
    });
    const video = scene.children[0];
    v.expect(video.props.translation).toEqual([10, 20]);
    v.expect(video.props.control).toBe('pause');
    v.expect(video.props.seek).toBe(12);
    v.expect(player.snapshot.state).toBe('paused');
    player.dispose();
  });

  v.it('passes headers, stream format and DRM to the host bridge', async () => {
    const host = fakeHost({ hevc: true, widevine: true });
    const player = createRokuPlayer(root(), {
      host,
      streamFormat: 'hls',
      httpHeaders: { 'X-Tenant': 't1' },
      drm: { keySystem: 'Widevine', licenseServerURL: 'https://lic.test/wv' },
    });
    const opened = player.open({
      url: 'https://example.test/movie.m3u8',
      kind: 'vod',
      paused: true,
      authorization: { headers: { Authorization: 'Bearer x' }, cookie: 'a=1' },
    });
    await Promise.resolve();
    const open = host.sent[0];
    v.expect(open.op).toBe('open');
    v.expect(open.url).toBe('https://example.test/movie.m3u8');
    v.expect(open.streamFormat).toBe('hls');
    v.expect(open.httpHeaders).toMatchObject({
      'X-Tenant': 't1',
      Authorization: 'Bearer x',
      Cookie: 'a=1',
    });
    v.expect(open.keySystem).toBe('Widevine');
    v.expect(open.licenseServerURL).toBe('https://lic.test/wv');
    host.emit({ type: 'state', state: 'paused', position: 0, duration: 90 });
    await opened;
    v.expect(player.snapshot.state).toBe('paused');

    host.emit({
      type: 'tracks',
      audio: [{ id: 'a1', label: 'English', available: true }],
      text: [],
      selectedAudioId: 'a1',
      selectedTextId: null,
    });
    v.expect(player.snapshot.tracks.audio[0].id).toBe('a1');

    host.emit({ type: 'state', state: 'playing', position: 4, duration: 90 });
    v.expect(player.snapshot.state).toBe('playing');
    v.expect(player.snapshot.time.positionSeconds).toBe(4);

    await player.setRate(-4);
    v.expect(host.sent.at(-1)).toMatchObject({ op: 'rate', value: -4 });

    host.emit({ type: 'error', code: 404, message: 'Not Found' });
    v.expect(player.snapshot.state).toBe('error');
    v.expect(player.snapshot.error.code).toBe('expired-source');

    player.dispose();
    v.expect(host.unsubscribed).toBe(true);
    v.expect(host.sent.at(-1).op).toBe('dispose');
  });

  v.it('drives mediaSession handlers and disposes them', async () => {
    const host = fakeHost();
    const handlers = new Map();
    const states = [];
    host.mediaSession = {
      setMetadata() {},
      setPlaybackState(state) {
        states.push(state);
      },
      setPositionState() {},
      setActionHandler(action, handler) {
        if (handler) handlers.set(action, handler);
        else handlers.delete(action);
      },
    };
    const player = createRokuPlayer(root(), {
      host,
      metadata: { title: 'A film' },
      onNext: (each) => each.seek(120),
    });
    const opened = player.open({
      url: 'https://example.test/movie.m3u8',
      kind: 'vod',
      paused: true,
    });
    await Promise.resolve();
    host.emit({ type: 'state', state: 'paused', position: 0, duration: 90 });
    await opened;

    handlers.get('play')();
    v.expect(host.sent.at(-1).op).toBe('play');
    host.emit({ type: 'state', state: 'playing', position: 2, duration: 90 });
    v.expect(states).toContain('playing');
    handlers.get('pause')();
    v.expect(host.sent.at(-1).op).toBe('pause');
    handlers.get('seekto')({ seekTime: 42 });
    v.expect(host.sent.at(-1)).toMatchObject({ op: 'seek', seconds: 42 });
    handlers.get('seekforward')();
    v.expect(host.sent.at(-1).op).toBe('seek');
    handlers.get('stop')();
    await Promise.resolve();
    v.expect(host.sent.at(-1).op).toBe('dispose');

    player.dispose();
    v.expect(handlers.size).toBe(0);
    v.expect(states.at(-1)).toBe('none');
  });

  v.it('schedules no timer and removes its node on teardown', async () => {
    const scene = root();
    const player = createRokuPlayer(scene);
    await player.open({ url: 'https://example.test/a.mp4', kind: 'vod' });
    v.expect(scene.children).toHaveLength(1);
    player.dispose();
    v.expect(scene.children).toHaveLength(0);
    v.expect(player.snapshot.state).toBe('disposed');
    v.expect(player.driver).toBeUndefined();
  });

  v.it('reports the documented and firmware capabilities honestly', () => {
    const documented = rokuMediaCapabilities();
    v.expect(documented.drm).toContain('com.widevine.alpha');
    v.expect(documented.codecs).toContain('application/vnd.apple.mpegurl');
    const queried = rokuMediaCapabilities({ widevine: false, hevc: false });
    v.expect(queried.drm).not.toContain('com.widevine.alpha');
    v.expect(
      queried.codecs.some((codec) => codec.includes('hvc1')),
    ).toBe(false);
    v.expect(rokuMediaCapabilities({ hdr10: true }).hdr).toBe(true);
    v.expect(rokuPlaybackCapabilities({ hevc: true })).toMatchObject({
      h264: true,
      hevc: true,
      directHls: true,
    });
    v.expect(rokuStreamFormat('https://x/a.m3u8')).toBe('hls');
    v.expect(rokuStreamFormat('https://x/a.mpd')).toBe('dash');
    v.expect(rokuStreamFormat('https://x/a', 'mkv')).toBe('mkv');
  });
});
