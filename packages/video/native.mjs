import {
  SessionPlayer,
  PlayerOperationError,
  boundedPosition,
  timelineDuration,
  growOnlyDuration,
  checkedSourceAuthorization,
} from './core.mjs';
export { PlaybackSessionController, PlayerOperationError } from './core.mjs';

const unsupported = () =>
  new PlayerOperationError(
    'unsupported-operation',
    'This playback operation is unavailable on this device.',
  );
export class NativePlayer extends SessionPlayer {
  constructor(platform, engine, create, features = {}) {
    super();
    this.create = create;
    this.capabilities = {
      platform,
      engine,
      directNative: 'supported',
      adaptiveStreaming: 'probe-required',
      drm: 'probe-required',
      canPause: true,
      canSeek: true,
      canSelectAudioTrack: false,
      canSelectTextTrack: false,
      canDisableTextTrack: false,
      canUseCookies: false,
      canUseUserAgent: false,
      canSetVolume: false,
      limitations: [],
      ...features,
    };
  }
  async open(request) {
    if (this.snapshot.state === 'disposed')
      throw new PlayerOperationError('invalid-state', 'Player is disposed');
    const authorization = checkedSourceAuthorization(request.authorization);
    if (authorization)
      throw new PlayerOperationError(
        'authorization-unsupported',
        'Native delivery requires a source the device can open.',
      );
    if (
      request.qualityId ||
      (request.audioTrackId && !this.capabilities.canSelectAudioTrack) ||
      (request.textTrackId && !this.capabilities.canSelectTextTrack)
    )
      throw unsupported();
    this.closeDriver();
    const id = this.startSession(request.kind),
      offset = request.timelineOffsetSeconds ?? 0;
    this.offset = offset;
    this.request = request;
    let timer;
    try {
      this.driver = this.create(request, (patch) => {
        if (!this.isCurrent(id)) return;
        if (patch.time) {
          const t = patch.time;
          patch = {
            ...patch,
            time: {
              ...t,
              positionSeconds: offset + t.positionSeconds,
              durationSeconds: growOnlyDuration(
                this.snapshot.time.durationSeconds,
                timelineDuration(
                  request.timelineDurationSeconds,
                  t.durationSeconds,
                  request.adoptEngineDuration ??
                    request.deliveryMode !== 'managed',
                ),
              ),
            },
          };
        }
        this.update(id, patch);
      });
      const driver = this.driver;
      const interrupted = new Promise((_, reject) => {
        this.interrupt = reject;
      });
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new PlayerOperationError(
                'prepare-failed',
                'Native player readiness timed out',
              ),
            ),
          Math.max(1, Math.min(20000, request.startupBudgetMs ?? 20000)),
        );
      });
      const prepare = async () => {
        await driver.prepare(request.url);
        if (!this.isCurrent(id)) return;
        if (request.audioTrackId)
          await driver.selectAudioTrack(request.audioTrackId);
        if (!this.isCurrent(id)) return;
        if (request.textTrackId !== undefined && driver.selectTextTrack)
          await driver.selectTextTrack(request.textTrackId);

        if (!this.isCurrent(id)) return;
        if (request.kind === 'vod' && request.startAtSeconds > 0)
          await driver.seek(request.startAtSeconds);
        if (!this.isCurrent(id)) return;
        this.update(id, { state: 'ready' });
        if (!request.paused) await driver.play();
        if (request.paused) {
          await driver.pause();
          this.update(id, { state: 'paused' });
        }
      };
      await Promise.race([interrupted, timeout, prepare()]);
      if (!this.isCurrent(id))
        throw new PlayerOperationError(
          'invalid-state',
          'Playback was replaced',
        );
    } catch (error) {
      if (this.isCurrent(id)) {
        const failure =
          error instanceof PlayerOperationError
            ? error
            : new PlayerOperationError(
                'prepare-failed',
                'Native engine failed to open the source',
              );
        this.fail(id, failure.toFailure());
        this.invalidateSession();
        this.closeDriver();
        throw failure;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (this.isCurrent(id)) this.interrupt = undefined;
    }
  }
  closeDriver() {
    this.invalidateSession();
    this.interrupt?.(
      new PlayerOperationError('invalid-state', 'Playback interrupted'),
    );
    this.interrupt = undefined;
    const old = this.driver;
    this.driver = undefined;
    old?.dispose();
  }
  async perform(op, ...args) {
    const id = this.activeSessionOrThrow();
    if (!this.driver?.[op]) throw unsupported();
    await this.driver[op](...args);
    if (!this.isCurrent(id))
      throw new PlayerOperationError('invalid-state', 'Playback replaced');
  }
  play() {
    return this.perform('play');
  }
  pause() {
    return this.perform('pause');
  }
  async seek(seconds) {
    this.activeSessionOrThrow();
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new PlayerOperationError('seek-failed', 'Invalid seek position');
    if (this.snapshot.kind === 'live' && !this.snapshot.time.liveWindow)
      throw unsupported();
    return this.perform('seek', boundedPosition(seconds - this.offset, null));
  }
  selectAudioTrack(id) {
    return this.perform('selectAudioTrack', id);
  }
  selectTextTrack(id) {
    return this.perform('selectTextTrack', id);
  }
  setPictureMode(mode) {
    return this.perform('setPictureMode', mode);
  }
  setVolume(level) {
    return this.perform('setVolume', Math.max(0, Math.min(1, level)));
  }
  setMuted(muted) {
    return this.perform('setMuted', muted);
  }
  async stop() {
    if (this.snapshot.state === 'disposed') return;
    this.closeDriver();
    this.terminal('stopped');
  }
  async dispose() {
    if (this.snapshot.state === 'disposed') return;
    this.closeDriver();
    this.terminal('disposed');
  }
}
