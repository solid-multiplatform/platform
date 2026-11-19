/**
 * The Roku SceneGraph playback adapter.
 *
 * The Video node is a layer of its own, inserted before the app's scene tree
 * (its transparent regions composite over it), never a player stacked above
 * the UI. Two drivers share one state machine:
 *
 *  - `host`: the Roku host owns a `Video` node under `SolidApp` in
 *    BaseAppScene.xml. The host installs `globalThis.__smpRokuVideoHost`; the
 *    adapter sends JSON commands through the anchor's output field and receives
 *    events through its input field. This is the device path: it can call
 *    `Video.setCertificate` and place the node under the scene.
 *  - local: no host bridge (unit tests, a bare SceneGraph host). The adapter
 *    creates the Video node itself and inserts it as the first child of the
 *    app root, under the renderer's scene tree.
 */
import {
  createElement,
  insertNode,
  setProp,
  tmTransaction,
} from '@roku-sdk/solid';
import { NativePlayer, PlayerOperationError } from './native.mjs';

const DOCUMENTED_CODECS = [
  'video/mp4; codecs="avc1.42E01E"',
  'video/mp4; codecs="hvc1.1.6.L93.B0"',
  'audio/mp4; codecs="mp4a.40.2"',
  'audio/mp4; codecs="ac-3"',
  'audio/mp4; codecs="ec-3"',
  'audio/mpeg',
  'application/vnd.apple.mpegurl',
  'application/dash+xml',
];

const DRM_SCHEME = {
  widevine: 'com.widevine.alpha',
  playready: 'com.microsoft.playready',
  fairplay: 'com.apple.fps',
};

/**
 * A firmware feature query when the host supplies one (`roku.hasFeature`, read
 * by the host), otherwise the documented Roku playback set. False from an
 * unknown feature key is not evidence of absence, so keys the host did not
 * report fall back to the documented answer.
 */
function featureQuery(features) {
  return (key, documented = true) => {
    if (features && Object.prototype.hasOwnProperty.call(features, key))
      return !!features[key];
    return documented;
  };
}

/** The `mediaCapabilities` service shape for a Roku device. */
export function rokuMediaCapabilities(features) {
  const has = featureQuery(features);
  const drm = [];
  if (has('widevine')) drm.push(DRM_SCHEME.widevine);
  if (has('playready')) drm.push(DRM_SCHEME.playready);
  if (has('fairplay')) drm.push(DRM_SCHEME.fairplay);
  const codecs = DOCUMENTED_CODECS.filter((codec) => {
    if (codec.includes('hvc1')) return has('hevc');
    if (codec.includes('dash')) return has('dash');
    return true;
  });
  const hdr =
    (features && (features.hdr10 || features.dolby_vision)) === true;
  return { drm, codecs, hdr };
}

/** The server-facing capabilities (`PlaybackCapabilities`) for a Roku device. */
export function rokuPlaybackCapabilities(features) {
  const has = featureQuery(features);
  const hevc = has('hevc');
  const fourK = features && (features['4k'] || features.uhd) === true;
  return {
    maxWidth: fourK ? 3840 : 1920,
    maxHeight: fourK ? 2160 : 1080,
    h264: true,
    hevc,
    aac: true,
    directPlay: true,
    directMp4: true,
    directHls: true,
    directUrls: true,
    hevcSdr: hevc,
  };
}

/** The stream format the firmware expects for a delivery URL. */
export function rokuStreamFormat(url, format) {
  const hint = String(format ?? '').toLowerCase();
  if (hint === 'hls' || hint === 'm3u8') return 'hls';
  if (hint === 'dash' || hint === 'mpd') return 'dash';
  if (hint === 'smooth' || hint === 'ism') return 'ism';
  if (hint === 'mkv') return 'mkv';
  if (hint === 'mp4' || hint === 'm4v') return 'mp4';
  const path = String(url ?? '').split('?')[0].toLowerCase();
  if (path.endsWith('.m3u8')) return 'hls';
  if (path.endsWith('.mpd')) return 'dash';
  if (path.endsWith('.ism') || path.endsWith('.isml')) return 'ism';
  if (path.endsWith('.mkv')) return 'mkv';
  return 'mp4';
}

/** Roku's firmware error code and message, mapped to the SDK's failure shape. */
export function rokuFailure(code, message) {
  const text = String(message ?? '');
  const numeric = Number(code);
  let failure = 'prepare-failed';
  let reason;
  if (/network|connect|timed? ?out|unreachable|resolve|socket/i.test(text)) {
    failure = 'connection-failed';
    reason = 'network';
  } else if (/\b(401|403)\b|unauthori[sz]ed|forbidden/i.test(text)) {
    failure = 'authorization-failed';
    reason = 'authorization';
  } else if (/\b(404|410)\b|not found|expired/i.test(text)) {
    failure = 'expired-source';
  } else if (/unsupported|codec|format|decode/i.test(text)) {
    failure = 'unsupported-format';
    reason = 'container';
  }
  const detail = numeric > 0 || text
    ? ` (Roku error ${numeric || 'unknown'}${text ? ': ' + text : ''})`
    : '';
  return new PlayerOperationError(
    failure,
    'SceneGraph playback failed' + detail,
    { firmwareCode: Number.isFinite(numeric) ? numeric : null, firmwareMessage: text },
    reason,
  );
}

function availableTracks(list, idField) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((track) => track && typeof track[idField] === 'string')
    .map((track) => ({
      id: track[idField],
      label:
        track.Description || track.Name || track.Language || track[idField],
      language: track.Language,
      available: true,
    }));
}

function json(command) {
  return JSON.stringify(command);
}

/** The host owns a Video node under the scene; talk to it through the anchor. */
function createHostDriver(bridge, request, emit, options) {
  let live = true;
  let settle;
  let reject;
  let settled = false;
  let position = 0;
  let duration = null;
  let tracks = { audio: [], text: [], selectedAudioId: null, selectedTextId: null };
  let offset = 0;

  const finish = (error) => {
    if (settled) return;
    settled = true;
    if (error) reject?.(error);
    else settle?.();
  };
  const time = () =>
    emit({ time: { positionSeconds: position, durationSeconds: duration } });
  const publishTracks = (change) => {
    if (!live) return;
    tracks = { ...tracks, ...change };
    emit({ tracks });
  };
  const failure = (event) =>
    rokuFailure(
      event.code ?? event.firmwareCode,
      event.message ?? event.firmwareMessage,
    );

  const unsubscribe = bridge.subscribe((event) => {
    if (!live || !event || typeof event !== 'object') return;
    switch (event.type) {
      case 'ready':
        finish();
        break;
      case 'state': {
        if (typeof event.position === 'number')
          position = Math.max(0, event.position);
        if (typeof event.duration === 'number' && event.duration > 0)
          duration = event.duration;
        const state = event.state;
        if (state === 'playing' || state === 'paused' || state === 'buffering') {
          emit({ state });
          time();
          if (state !== 'buffering') finish();
        } else if (state === 'finished' || state === 'ended') {
          time();
          emit({ state: 'ended' });
          finish();
        } else if (state === 'error') {
          const error = failure(event);
          emit({ state: 'error', error: error.toFailure(), time: {
            positionSeconds: position,
            durationSeconds: duration,
          } });
          finish(error);
        }
        break;
      }
      case 'position':
        position = Math.max(0, Number(event.position) || 0) + offset;
        time();
        break;
      case 'duration':
        if (Number(event.duration) > 0) duration = Number(event.duration);
        time();
        break;
      case 'tracks':
        publishTracks({
          audio: Array.isArray(event.audio) ? event.audio : tracks.audio,
          text: Array.isArray(event.text) ? event.text : tracks.text,
          selectedAudioId: event.selectedAudioId ?? tracks.selectedAudioId,
          selectedTextId: event.selectedTextId ?? tracks.selectedTextId,
        });
        break;
      case 'error': {
        const error = failure(event);
        emit({ state: 'error', error: error.toFailure() });
        finish(error);
        break;
      }
    }
  });

  const send = (command) => {
    if (live) bridge.send(json(command));
  };

  return {
    prepare() {
      return new Promise((resolve, rejectPrepare) => {
        settle = resolve;
        reject = rejectPrepare;
        if (!live) return finish(new PlayerOperationError('invalid-state', 'Player is disposed'));
        const headers = {
          ...(options.httpHeaders ?? {}),
          ...(request.authorization?.headers ?? {}),
          ...(request.authorization?.cookie
            ? { Cookie: request.authorization.cookie }
            : {}),
        };
        const drm = options.drm ?? {};
        const command = {
          op: 'open',
          url: request.url,
          streamFormat: options.streamFormat
            ? rokuStreamFormat(request.url, options.streamFormat)
            : rokuStreamFormat(request.url, request.deliveryFormat),
          httpHeaders: Object.keys(headers).length ? headers : undefined,
          keySystem: drm.keySystem,
          licenseServerURL: drm.licenseServerURL,
          certificate: drm.certificate,
          drmParams: drm.params,
          startAt: request.startAtSeconds > 0 ? request.startAtSeconds : undefined,
          paused: !!request.paused,
          mute: !!options.muted,
          audioTrack: request.audioTrackId,
          textTrack: request.textTrackId === null ? 'off' : request.textTrackId,
          trickPlay: options.trickPlay !== false,
          seq: Date.now(),
        };
        send(command);
      });
    },
    play: () => send({ op: 'play', seq: Date.now() }),
    pause: () => send({ op: 'pause', seq: Date.now() }),
    seek: (seconds) => {
      position = Math.max(0, Number(seconds) || 0) + offset;
      send({ op: 'seek', seconds: Number(seconds) || 0, seq: Date.now() });
    },
    setMuted: (value) => send({ op: 'mute', value: !!value, seq: Date.now() }),
    setRate: (rate) =>
      send({ op: 'rate', value: Number(rate) || 1, seq: Date.now() }),
    selectAudioTrack(id) {
      if (!tracks.audio.some((track) => track.id === id))
        throw new PlayerOperationError('unsupported-operation', 'Track unavailable');
      publishTracks({ selectedAudioId: id });
      send({ op: 'audioTrack', id, seq: Date.now() });
    },
    selectTextTrack(id) {
      if (id !== null && !tracks.text.some((track) => track.id === id))
        throw new PlayerOperationError('unsupported-operation', 'Track unavailable');
      publishTracks({ selectedTextId: id });
      send({ op: 'textTrack', id: id ?? 'off', seq: Date.now() });
    },
    setPictureMode(mode) {
      send({ op: 'pictureMode', mode, seq: Date.now() });
    },
    dispose() {
      if (!live) return;
      send({ op: 'dispose', seq: Date.now() });
      live = false;
      unsubscribe?.();
      finish(new PlayerOperationError('invalid-state', 'Playback interrupted'));
    },
  };
}

/** A Video node the adapter creates and owns, under the app's scene tree. */
function createNodeDriver(root, request, emit, options) {
  const video = createElement('video');
  const content = createElement('contentNode');
  const layer = options.layer ?? root;
  let live = true;
  let settle;
  let reject;
  let settled = false;
  let position = 0;
  let duration = null;
  let props = {
    selectedAudioId: null,
    selectedTextId: null,
  };
  let tracks = {
    audio: [],
    text: [],
    selectedAudioId: null,
    selectedTextId: null,
  };
  const prop = (key, value) => {
    if (live) setProp(video, key, value);
  };
  const time = () =>
    emit({ time: { positionSeconds: position, durationSeconds: duration } });
  const finish = (error) => {
    if (settled) return;
    settled = true;
    if (error) reject?.(error);
    else settle?.();
  };
  const publishTracks = (change) => {
    if (!live) return;
    tracks = { ...tracks, ...change };
    emit({ tracks });
  };
  const select = (kind, id) => {
    if (id !== null && !tracks[kind].some((track) => track.id === id))
      throw new PlayerOperationError('unsupported-operation', 'Track unavailable');
    props[kind === 'text' ? 'selectedTextId' : 'selectedAudioId'] = id;
    prop(kind === 'text' ? 'subtitleTrack' : 'audioTrack', id ?? 'off');
    publishTracks(
      kind === 'text' ? { selectedTextId: id } : { selectedAudioId: id },
    );
  };

  prop('translation', [options.x ?? 0, options.y ?? 0]);
  prop('width', options.width ?? 1920);
  prop('height', options.height ?? 1080);
  prop('visible', options.visible ?? true);
  prop('enableUI', false);
  prop('notificationInterval', 1);
  prop('enableTrickPlay', options.trickPlay !== false);

  prop('onPosition', (value) => {
    if (!live) return;
    position = Math.max(0, Number(value) || 0);
    time();
  });
  prop('onDuration', (value) => {
    if (!live) return;
    if (Number(value) > 0) duration = Number(value);
    time();
  });
  let firmwareCode = 0;
  let firmwareMessage = '';
  prop('onErrorCode', (value) => {
    firmwareCode = Number(value) || 0;
  });
  prop('onErrorMsg', (value) => {
    firmwareMessage = String(value ?? '');
  });
  prop('onState', (state) => {
    if (!live) return;
    if (state === 'buffering') {
      emit({ state: 'buffering' });
      time();
    } else if (state === 'playing' || state === 'paused') {
      emit({ state });
      time();
      finish();
    } else if (state === 'finished') {
      time();
      emit({ state: 'ended' });
      finish();
    } else if (state === 'error') {
      const error = rokuFailure(firmwareCode, firmwareMessage);
      emit({ state: 'error', error: error.toFailure() });
      finish(error);
    }
  });
  prop('onAvailableAudioTracks', (list) =>
    publishTracks({ audio: availableTracks(list, 'Track') }),
  );
  prop('onAvailableSubtitleTracks', (list) =>
    publishTracks({ text: availableTracks(list, 'TrackName') }),
  );
  prop('onAudioTrack', (id) =>
    publishTracks({ selectedAudioId: id || null }),
  );
  prop('onSubtitleTrack', (id) =>
    publishTracks({ selectedTextId: id && id !== 'off' ? id : null }),
  );

  // First child: the renderer's scene tree is inserted after it, so the app
  // composites over the video. Appending it would put the player above the UI.
  const first = layer.children?.[0];
  insertNode(layer, video, first);

  return {
    prepare() {
      return new Promise((resolve, rejectPrepare) => {
        settle = resolve;
        reject = rejectPrepare;
        if (!live)
          return finish(
            new PlayerOperationError('invalid-state', 'Player is disposed'),
          );
        const headers = {
          ...(options.httpHeaders ?? {}),
          ...(request.authorization?.headers ?? {}),
          ...(request.authorization?.cookie
            ? { Cookie: request.authorization.cookie }
            : {}),
        };
        const drm = options.drm ?? {};
        setProp(content, 'url', request.url);
        setProp(
          content,
          'streamFormat',
          options.streamFormat
            ? rokuStreamFormat(request.url, options.streamFormat)
            : rokuStreamFormat(request.url, request.deliveryFormat),
        );
        if (Object.keys(headers).length)
          setProp(content, 'httpHeaders', headers);
        if (drm.keySystem) setProp(content, 'keySystem', drm.keySystem);
        if (drm.licenseServerURL)
          setProp(content, 'licenseServerURL', drm.licenseServerURL);
        if (drm.params) setProp(content, 'drmParams', drm.params);
        if (drm.certificate)
          throw new PlayerOperationError(
            'unsupported-operation',
            'DRM certificates need the Roku host bridge (Video.setCertificate).',
          );
        prop('content', content);
        // Buffer without showing a frame until NativePlayer has seeked.
        prop('control', 'prebuffer');
      });
    },
    play: () => prop('control', 'play'),
    pause: () => prop('control', 'pause'),
    seek: (seconds) => {
      position = Math.max(0, Number(seconds) || 0);
      prop('seek', Number(seconds) || 0);
    },
    setMuted: (value) => prop('mute', !!value),
    setRate: (rate) => {
      prop('enableTrickPlay', true);
      prop('trickPlaySpeed', Number(rate) || 1);
    },
    selectAudioTrack: (id) => select('audio', id),
    selectTextTrack: (id) => select('text', id),
    setPictureMode(mode) {
      prop('scaleMode', mode === 'fill' ? 'zoomToFill' : 'scaleToFit');
    },
    dispose() {
      if (!live) return;
      prop('control', 'stop');
      for (const key of [
        'onPosition',
        'onDuration',
        'onErrorCode',
        'onErrorMsg',
        'onState',
        'onAvailableAudioTracks',
        'onAvailableSubtitleTracks',
        'onAudioTrack',
        'onSubtitleTrack',
      ])
        setProp(video, key, undefined);
      tmTransaction.removeNode(layer, video);
      live = false;
      finish(new PlayerOperationError('invalid-state', 'Playback interrupted'));
    },
  };
}

/** Wire `mediaSession` handlers to the adapter's own commands. */
function bindMediaSession(player, session, options) {
  if (!session || typeof session.setActionHandler !== 'function') return () => {};
  const ignore = (error) => {
    if (!(error instanceof PlayerOperationError)) throw error;
  };
  const seekBy = (delta) => {
    const current = player.snapshot.time.positionSeconds;
    return player.seek(Math.max(0, current + delta)).catch(ignore);
  };
  const actions = {
    play: () => player.play().catch(ignore),
    pause: () => player.pause().catch(ignore),
    stop: () => player.stop().catch(ignore),
    seekto: (details) => player.seek(details.seekTime).catch(ignore),
    seekbackward: () => seekBy(-5),
    seekforward: () => seekBy(5),
    nexttrack: () => options.onNext?.(player),
    previoustrack: () => options.onPrevious?.(player),
  };
  if (options.metadata) session.setMetadata?.(options.metadata);
  for (const action of Object.keys(actions))
    session.setActionHandler(action, actions[action]);
  const unsubscribe = player.subscribe((snapshot) => {
    session.setPlaybackState?.(
      snapshot.state === 'playing'
        ? 'playing'
        : snapshot.state === 'paused'
          ? 'paused'
          : 'none',
    );
    const duration = snapshot.time.durationSeconds;
    if (duration && duration > 0)
      session.setPositionState?.({
        duration,
        position: Math.min(snapshot.time.positionSeconds, duration),
        playbackRate: 1,
      });
  });
  return () => {
    for (const action of Object.keys(actions))
      session.setActionHandler(action, undefined);
    session.setPlaybackState?.('none');
    unsubscribe();
  };
}

class RokuPlayer extends NativePlayer {
  constructor(root, options, features) {
    const caps = rokuMediaCapabilities(features);
    const playback = rokuPlaybackCapabilities(features);
    super(
      'roku',
      'scenegraph',
      (request, emit) =>
        options.host
          ? createHostDriver(options.host, request, emit, options)
          : createNodeDriver(root, request, emit, options),
      {
        directNative: 'supported',
        adaptiveStreaming: 'supported',
        drm: caps.drm.length ? 'supported' : 'probe-required',
        canSetVolume: false,
        canSelectAudioTrack: true,
        canSelectTextTrack: true,
        canDisableTextTrack: true,
        canUseCookies: true,
        canUseUserAgent: false,
        canUseRequestHeaders: true,
        limitations: [
          'SceneGraph has no per-player volume; mute and device volume only.',
          ...(caps.drm.length ? [] : ['No DRM key system is reported.']),
        ],
      },
    );
    this.mediaCapabilities = caps;
    this.playbackCapabilities = playback;
    this.options = options;
    this.sessionCleanup = bindMediaSession(
      this,
      options.mediaSession ?? options.host?.mediaSession,
      options,
    );
  }

  /** Trick-play speed: positive forwards, negative rewinds, 1 resumes. */
  setRate(rate) {
    return this.perform('setRate', Number(rate) || 1);
  }

  fastForward(multiplier = 2) {
    return this.setRate(Math.abs(multiplier) || 2);
  }

  rewind(multiplier = 2) {
    return this.setRate(-(Math.abs(multiplier) || 2));
  }

  /** SceneGraph has no per-player volume; `setMuted` is the supported control. */
  async setVolume() {
    throw new PlayerOperationError(
      'unsupported-operation',
      'SceneGraph has no per-player volume. Use setMuted.',
    );
  }

  async dispose() {
    this.sessionCleanup?.();
    this.sessionCleanup = undefined;
    return super.dispose();
  }
}

/**
 * `root` is the app's SceneGraph group. `options.layer` (optional) is a group
 * placed beneath the app tree by the host; without one the adapter inserts its
 * Video node as the root's first child, below the renderer's scene tree.
 */
export function createRokuPlayer(root, options = {}) {
  const host = options.host ?? globalThis.__smpRokuVideoHost;
  const features = options.features ?? host?.features?.();
  return new RokuPlayer(root, { ...options, host }, features);
}
