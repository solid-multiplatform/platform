// core/types.ts
var PlayerOperationError = class extends Error {
  constructor(code, message, cause, reason, selection) {
    super(message);
    this.cause = cause;
    this.reason = reason;
    this.selection = selection;
    this.name = "PlayerOperationError";
    this.code = code;
  }
  cause;
  reason;
  selection;
  code;
  toFailure() {
    return { code: this.code, message: this.message, cause: this.cause, ...this.reason ? { reason: this.reason } : {}, ...this.selection ? { selection: this.selection } : {} };
  }
};
function knownSeconds(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
function timelineDuration(authoritativeSeconds, engineSeconds, adoptEngineDuration = false) {
  const known = knownSeconds(authoritativeSeconds);
  if (!adoptEngineDuration) return known;
  const engine = knownSeconds(engineSeconds);
  if (known === null) return engine;
  return engine !== null && engine > known ? engine : known;
}
function boundedPosition(position, duration) {
  if (!Number.isFinite(position) || position <= 0) return 0;
  return duration === null ? position : Math.min(position, duration);
}
function growOnlyDuration(previous, next) {
  if (next === null) return previous;
  if (previous === null) return next;
  return next > previous ? next : previous;
}
var EMPTY_TRACKS = {
  audio: [],
  text: [],
  selectedAudioId: null,
  selectedTextId: null
};
var IDLE_SNAPSHOT = {
  sessionId: 0,
  state: "idle",
  kind: null,
  time: { positionSeconds: 0, durationSeconds: null },
  tracks: EMPTY_TRACKS,
  error: null
};

// core/browser-policy.ts
function canChangeMediaPath(failure) {
  return ["unsupported-format", "engine-unavailable", "performance-limited"].includes(failure.code) && !["network", "authorization", "autoplay"].includes(failure.reason ?? "");
}

// core/session-request.ts
function playbackRequest(intent, capabilities, position) {
  if (intent.item.type === "live") return { channelId: intent.item.id, position, capabilities };
  if (!intent.source) throw new Error("VOD playback requires an explicit source.");
  return { streamId: intent.source.id, position, capabilities };
}
function isOriginalDelivery(session) {
  return session.deliveryKind ? session.deliveryKind === "direct" : session.mode === "direct";
}
function adapterRequest(session, kind, position, paused) {
  const direct = isOriginalDelivery(session);
  const deliveryStart = kind === "live" || direct ? 0 : Math.max(0, session.timelineOffsetSeconds ?? session.position);
  const originalClock = direct || session.timelineOffsetSeconds === 0 && session.format === "mp4";
  return {
    preferredAudioLanguage: session.preferredAudioLanguage,
    preferredSubtitleLanguage: session.preferredSubtitleLanguage,
    url: session.url,
    kind,
    startAtSeconds: kind === "live" ? 0 : Math.max(0, position - deliveryStart),
    timelineOffsetSeconds: deliveryStart,
    // A managed delivery is a rolling window; only the session knows how long
    // the title is. Direct original files may refine it with their own length.
    timelineDurationSeconds: kind === "live" || !(session.duration > 0) ? void 0 : session.duration,
    adoptEngineDuration: originalClock,
    deliveryMode: direct ? "direct" : "managed",
    deliveryFormat: session.format,
    deliveryDecision: ["encode", "transcode"].includes(session.videoMode) ? "video-conversion" : ["encode", "transcode"].includes(session.audioMode) ? "audio-conversion" : direct ? "original" : "server-remux",
    paused,
    authorization: direct ? session.authorization : void 0
  };
}
function itemKind(item) {
  return item.type === "live" ? "live" : "vod";
}
function playerState(player) {
  return player.snapshot.state === "error" ? "error" : "playing";
}
function asError(cause) {
  return cause instanceof Error ? cause : new Error("Playback operation failed.");
}
function refusalStatus(error) {
  if (!(error instanceof Error)) return void 0;
  const { status } = error;
  return typeof status === "number" ? status : void 0;
}
function escalatePreparation(request, error) {
  const status = refusalStatus(error);
  if (status !== 406) return void 0;
  if (error instanceof Error && "code" in error && error.code === "source_format_unsupported") return void 0;
  if (!request.managedOnly) return { ...request, managedOnly: true };
  if (!request.forceTranscode) return { ...request, managedOnly: true, forceTranscode: true };
  return void 0;
}
function failureRetryRequest(recovery, failure) {
  return { ...recovery, ...failure?.selection, ...failure?.reason ? { conversionReason: failure.reason } : {} };
}
function recoveryRequest(session, request, code) {
  if ((code === "connection-failed" || code === "authorization-unsupported") && isOriginalDelivery(session) && !request.managedOnly)
    return { ...request, managedOnly: true };
  if (code === "engine-unavailable" || !canChangeMediaPath({ code })) return void 0;
  if (isOriginalDelivery(session) && !request.managedOnly)
    return { ...request, managedOnly: true };
  if (!isOriginalDelivery(session) && !request.forceTranscode)
    return { ...request, managedOnly: true, forceTranscode: true };
  return void 0;
}

// core/session-player.ts
var SessionPlayer = class {
  listeners = /* @__PURE__ */ new Set();
  currentSession = 0;
  nextSession = 0;
  currentSnapshot = IDLE_SNAPSHOT;
  get snapshot() {
    return this.currentSnapshot;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.currentSnapshot);
    return () => this.listeners.delete(listener);
  }
  startSession(kind) {
    const sessionId = ++this.nextSession;
    this.currentSession = sessionId;
    this.publish({
      sessionId,
      state: "opening",
      kind,
      time: { positionSeconds: 0, durationSeconds: null },
      tracks: EMPTY_TRACKS,
      error: null
    });
    return sessionId;
  }
  isCurrent(sessionId) {
    return this.currentSession === sessionId;
  }
  /** An operation outside a live session is a programming error, not a failure. */
  activeSessionOrThrow() {
    if (this.snapshot.sessionId === 0 || !this.isCurrent(this.snapshot.sessionId)) {
      throw new PlayerOperationError("invalid-state", "No active playback session.");
    }
    return this.snapshot.sessionId;
  }
  /** Makes every previous callback inert. */
  invalidateSession() {
    this.currentSession = 0;
  }
  update(sessionId, patch) {
    if (!this.isCurrent(sessionId)) return;
    this.publish({ ...this.currentSnapshot, ...patch });
  }
  terminal(state) {
    const sessionId = ++this.nextSession;
    this.currentSession = 0;
    this.publish({
      sessionId,
      state,
      kind: null,
      time: { positionSeconds: 0, durationSeconds: null },
      tracks: EMPTY_TRACKS,
      error: null
    });
  }
  fail(sessionId, error) {
    this.update(sessionId, { state: "error", error });
  }
  publish(snapshot) {
    this.currentSnapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
};

// core/session.ts
var PlaybackSessionController = class {
  constructor(options) {
    this.options = options;
  }
  options;
  listeners = /* @__PURE__ */ new Set();
  current = null;
  nextGeneration = 0;
  operationGeneration = 0;
  pendingStarts = /* @__PURE__ */ new Map();
  nextOperation() {
    this.operationGeneration += 1;
    for (const [controller, wanted] of this.pendingStarts) if (!wanted()) controller.abort();
    return this.operationGeneration;
  }
  async prepareSession(request, wanted) {
    const controller = new AbortController();
    this.pendingStarts.set(controller, wanted);
    if (!wanted()) controller.abort();
    try {
      return await this.options.backend.startPlayback(request, { signal: controller.signal });
    } finally {
      this.pendingStarts.delete(controller);
    }
  }
  activePlayerSessionId = 0;
  retiringPresentation;
  pausedPlayerSessionId = 0;
  recoveredSessions = /* @__PURE__ */ new Set();
  /** The one next-operation Back is allowed to restore after adapter open. */
  restoreRequestedOperation = null;
  currentSnapshot = { state: "idle", active: null, error: null };
  get snapshot() {
    return this.currentSnapshot;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.currentSnapshot);
    return () => this.listeners.delete(listener);
  }
  async start(intent) {
    this.recoveredSessions.clear();
    this.cancelNext(false);
    const operation = this.nextOperation();
    if (this.options.retireOnReplace && this.current) {
      const previous = this.current;
      this.current = null;
      const closing = this.options.player.stop();
      const releasing = this.options.backend.stopPlayback(previous.session.id);
      const retirement = Promise.allSettled([closing, releasing]).then(() => void 0);
      this.retiringPresentation = retirement;
      void retirement.then(() => {
        if (this.retiringPresentation === retirement) this.retiringPresentation = void 0;
      });
    }
    this.publish({ state: this.current ? "replacing" : "opening", active: this.current, error: null });
    try {
      await this.retiringPresentation;
      if (operation !== this.operationGeneration) return this.cancelledResult();
      const capabilities = await this.resolveCapabilities();
      if (operation !== this.operationGeneration) return this.cancelledResult();
      let request = playbackRequest(intent, capabilities, intent.position ?? 0);
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await this.transition(intent, request, this.current, () => operation === this.operationGeneration, () => false);
        } catch (error) {
          if (operation !== this.operationGeneration) return this.cancelledResult();
          const escalated = attempt < 2 ? escalatePreparation(request, error) : void 0;
          if (!escalated) throw error;
          request = escalated;
        }
      }
    } catch (error) {
      if (operation !== this.operationGeneration) return this.cancelledResult();
      this.publish({
        state: this.current ? "playing" : "error",
        active: this.current,
        error: error instanceof Error ? error : new Error(String(error))
      });
      throw error;
    }
  }
  /** Observe the actual adapter snapshot, including decoder failures after open. */
  async recoverPlayback(snapshot) {
    if (snapshot.sessionId !== this.options.player.snapshot.sessionId) return true;
    if (snapshot.state === "paused") this.pausedPlayerSessionId = snapshot.sessionId;
    else if (snapshot.state === "playing") this.pausedPlayerSessionId = 0;
    if (!snapshot.error) return false;
    if (["opening", "replacing", "preparing-next"].includes(this.currentSnapshot.state)) return true;
    const active = this.current;
    if (!active || snapshot.sessionId !== this.activePlayerSessionId) return true;
    const recovery = this.options.backend.canConvertPlayback?.(active.session.id) === false ? void 0 : recoveryRequest(active.session, active.request, snapshot.error.code);
    const request = recovery ? failureRetryRequest(recovery, snapshot.error) : void 0;
    if (!request || this.recoveredSessions.has(active.session.id)) return false;
    this.recoveredSessions.add(active.session.id);
    this.cancelNext(false);
    const operation = this.nextOperation();
    const position = active.intent.item.type === "live" ? 0 : snapshot.time.positionSeconds;
    const paused = this.pausedPlayerSessionId === snapshot.sessionId;
    await this.transition(
      { ...active.intent, position },
      { ...request, position },
      active,
      () => operation === this.operationGeneration,
      () => false,
      { position, paused }
    );
    return true;
  }
  async seek(position) {
    this.cancelNext(false);
    const operation = this.nextOperation();
    const active = this.requireActive();
    if (!Number.isFinite(position) || position < 0) throw new Error("Seek position must be a non-negative number.");
    if (isOriginalDelivery(active.session)) {
      await this.options.player.seek(position);
      return;
    }
    const request = { ...active.request, position };
    await this.transition({ ...active.intent, position }, request, active, () => operation === this.operationGeneration);
  }
  /**
   * Repeated seeks: a replacement that is superseded before it starts is
   * abandoned at once instead of finishing a second managed session. Every
   * started session holds provider capacity, so rapid presses would otherwise
   * exhaust the provider's connection budget and be refused with 429.
   */
  async seekFrom(resolvePosition, currentPosition) {
    this.cancelNext(false);
    const operation = this.nextOperation();
    const active = this.requireActive();
    if (isOriginalDelivery(active.session)) {
      await this.options.player.seek(resolvePosition());
      return;
    }
    const position = resolvePosition();
    if (!Number.isFinite(position) || position < 0) throw new Error("Seek position must be a non-negative number.");
    const stillWanted = () => operation === this.operationGeneration;
    const request = { ...active.request, position };
    await this.transition(
      { ...active.intent, position },
      request,
      active,
      stillWanted,
      () => stillWanted(),
      { position: currentPosition(), paused: this.options.player.snapshot.state === "paused" }
    );
  }
  async replaceTracks(selection) {
    this.cancelNext(false);
    const operation = this.nextOperation();
    const active = this.requireActive();
    const position = this.options.player.snapshot.time.positionSeconds;
    const request = {
      ...active.request,
      position,
      ...selection,
      ...!isOriginalDelivery(active.session) ? { managedOnly: true } : {},
      ...selection.subtitlesOff ? { subtitleTrackIndex: void 0 } : {}
    };
    await this.transition({ ...active.intent, position }, request, active, () => operation === this.operationGeneration);
  }
  /**
   * The resolver is supplied by the UI/backend continuation flow. It must
   * provide the bounded next source already chosen by that flow; this module
   * never falls through to a different provider.
   */
  async prepareNext(resolveNext) {
    const active = this.requireActive();
    const generation = ++this.nextGeneration;
    const operation = this.nextOperation();
    this.restoreRequestedOperation = null;
    this.publish({ state: "preparing-next", active, error: null });
    try {
      const next = await resolveNext();
      if (generation !== this.nextGeneration) return;
      if (!next) {
        this.publish({ state: playerState(this.options.player), active: this.current, error: null });
        return;
      }
      const capabilities = await this.resolveCapabilities();
      if (generation !== this.nextGeneration || operation !== this.operationGeneration) return;
      const request = playbackRequest(next, capabilities, next.position ?? 0);
      await this.transition(
        next,
        request,
        active,
        () => generation === this.nextGeneration && operation === this.operationGeneration,
        () => this.restoreRequestedOperation === operation
      );
    } catch (cause) {
      if (generation !== this.nextGeneration) return;
      const error = asError(cause);
      this.publish({ state: "error", active: this.current, error });
      throw error;
    } finally {
      if (this.restoreRequestedOperation === operation) this.restoreRequestedOperation = null;
    }
  }
  /**
   * Back requests restoration if AVPlay/HTML media has already switched to a
   * next candidate. Internal replacement and stop callers pass false: their
   * newer operation owns the adapter and an old operation must stay inert.
   */
  cancelNext(restoreOutgoing = true) {
    if (!restoreOutgoing) this.restoreRequestedOperation = null;
    else if (this.currentSnapshot.state === "preparing-next" || this.currentSnapshot.state === "replacing") {
      this.restoreRequestedOperation = this.operationGeneration;
    }
    this.nextGeneration += 1;
    if (this.currentSnapshot.state === "preparing-next" || this.currentSnapshot.state === "replacing") {
      this.nextOperation();
      this.publish({ state: playerState(this.options.player), active: this.current, error: null });
    }
  }
  async stop(options = {}) {
    this.recoveredSessions.clear();
    this.cancelNext(false);
    const operation = this.nextOperation();
    const active = this.current;
    this.current = null;
    this.publish({ state: "stopped", active: null, error: null });
    const retirement = this.retiringPresentation;
    const releasing = active ? this.options.backend.stopPlayback(active.session.id) : Promise.resolve();
    const released = options.releaseBeforePlayer ? await Promise.allSettled([releasing]) : [];
    const nativeStop = !options.releaseBeforePlayer || operation === this.operationGeneration ? this.options.player.stop() : Promise.resolve();
    const stopped = await Promise.allSettled([nativeStop, retirement, ...options.releaseBeforePlayer ? [] : [releasing]]);
    const failed = [...stopped, ...released].find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    if (operation === this.operationGeneration) this.publish({ state: "stopped", active: null, error: null });
  }
  async transition(intent, request, previous, stillWanted = () => true, restoreOnCancellation = () => false, previousState) {
    const startupStarted = performance.now();
    const wasPaused = previousState?.paused ?? this.options.player.snapshot.state === "paused";
    const previousPosition = previousState?.position ?? this.options.player.snapshot.time.positionSeconds;
    this.publish({ state: previous ? "replacing" : "opening", active: previous, error: null });
    let session;
    try {
      session = await this.prepareSession(request, stillWanted);
    } catch (cause) {
      if (!stillWanted()) return this.cancelledResult();
      const error = asError(cause);
      this.publish({ state: "error", active: this.current, error });
      throw error;
    }
    if (!stillWanted()) {
      await this.options.backend.stopPlayback(session.id);
      return this.cancelledResult();
    }
    let owned = session;
    const releaseOwned = async () => {
      const released = owned;
      owned = void 0;
      if (released) await this.options.backend.stopPlayback(released.id);
    };
    try {
      for (; ; ) {
        try {
          const suppliedBudget = await this.options.backend.remainingStartupBudget?.(session.id);
          const budget = suppliedBudget === void 0 ? void 0 : Math.min(suppliedBudget, 12e4 - (performance.now() - startupStarted));
          if (budget !== void 0 && (!Number.isFinite(budget) || budget <= 0)) throw new PlayerOperationError("prepare-failed", "Playback startup timed out.");
          await this.options.player.open({ ...adapterRequest(session, itemKind(intent.item), request.position ?? 0, wasPaused), startupBudgetMs: budget });
          break;
        } catch (cause) {
          if (!(cause instanceof PlayerOperationError)) throw cause;
          const recovery = this.options.backend.canConvertPlayback?.(session.id) === false ? void 0 : recoveryRequest(session, request, cause.code);
          if (!stillWanted() || !recovery) throw cause;
          await releaseOwned();
          if (!stillWanted()) throw new DOMException("Playback operation was cancelled.", "AbortError");
          request = failureRetryRequest(recovery, cause);
          session = await this.prepareSession(request, stillWanted);
          owned = session;
          if (!stillWanted()) throw new DOMException("Playback operation was cancelled.", "AbortError");
        }
      }
      const candidate = { intent, request, session };
      if (!stillWanted()) {
        await releaseOwned();
        if (restoreOnCancellation()) {
          await this.restore(previous, previousPosition, wasPaused, restoreOnCancellation);
        }
        return this.cancelledResult();
      }
      this.current = candidate;
      owned = void 0;
      this.activePlayerSessionId = this.options.player.snapshot.sessionId;
      if (previous) await this.options.backend.stopPlayback(previous.session.id).catch(() => void 0);
      this.publish({ state: playerState(this.options.player), active: candidate, error: null });
      return candidate;
    } catch (cause) {
      const error = asError(cause);
      await releaseOwned().catch(() => void 0);
      const shouldRestore = () => stillWanted() || restoreOnCancellation();
      if (shouldRestore()) {
        try {
          await this.restore(previous, previousPosition, wasPaused, shouldRestore);
        } catch {
          this.current = null;
          await this.options.player.stop().catch(() => void 0);
          if (previous) await this.options.backend.stopPlayback(previous.session.id).catch(() => void 0);
        }
      }
      if (!stillWanted()) return this.cancelledResult();
      this.publish({ state: "error", active: this.current, error });
      throw error;
    }
  }
  async restore(previous, position, paused, stillRestore = () => true) {
    if (!previous) {
      this.current = null;
      return;
    }
    if (!stillRestore()) return;
    await this.options.player.open(adapterRequest(previous.session, itemKind(previous.intent.item), position, paused));
    if (!stillRestore()) return;
    this.current = previous;
    this.activePlayerSessionId = this.options.player.snapshot.sessionId;
    this.publish({ state: playerState(this.options.player), active: previous, error: null });
  }
  /** An invalidated UI operation either yields the current owner or AbortError. */
  cancelledResult() {
    if (this.current) {
      this.publish({ state: playerState(this.options.player), active: this.current, error: null });
      return this.current;
    }
    throw new DOMException("Playback operation was cancelled.", "AbortError");
  }
  async resolveCapabilities() {
    return typeof this.options.capabilities === "function" ? this.options.capabilities() : this.options.capabilities;
  }
  requireActive() {
    if (!this.current) throw new Error("No active playback session.");
    return this.current;
  }
  publish(snapshot) {
    this.currentSnapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
};

// core/source-authorization.ts
function checkedSourceAuthorization(input) {
  if (!input) return void 0;
  const headers = {};
  const seen = /* @__PURE__ */ new Set();
  let cookie = input.cookie, userAgent = input.userAgent;
  const valid = (value) => typeof value === "string" && value.length <= 8192 && !/[\u0000-\u001f\u007f]/.test(value);
  const invalid = () => new PlayerOperationError("authorization-failed", "The source supplied invalid playback authorization.");
  if (cookie !== void 0 && !valid(cookie) || userAgent !== void 0 && !valid(userAgent) || Object.keys(input.headers ?? {}).length > 32) throw invalid();
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    const key = name.toLowerCase();
    if (!/^[a-z0-9-]{1,128}$/i.test(name) || !valid(value) || seen.has(key) || ["host", "connection", "content-length", "transfer-encoding", "proxy-authorization", "upgrade", "keep-alive", "te", "trailer"].includes(key)) throw invalid();
    seen.add(key);
    if (key === "cookie") {
      if (cookie !== void 0 && cookie !== value) throw invalid();
      cookie = value;
    } else if (key === "user-agent") {
      if (userAgent !== void 0 && userAgent !== value) throw invalid();
      userAgent = value;
    } else headers[name] = value;
  }
  return { ...cookie ? { cookie } : {}, ...userAgent ? { userAgent } : {}, ...Object.keys(headers).length ? { headers } : {} };
}
export {
  PlaybackSessionController,
  PlayerOperationError,
  SessionPlayer,
  boundedPosition,
  checkedSourceAuthorization,
  growOnlyDuration,
  timelineDuration
};
