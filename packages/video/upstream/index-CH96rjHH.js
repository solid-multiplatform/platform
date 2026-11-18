import Hls, { FetchLoader } from 'hls.js';
import { invoke } from '@tauri-apps/api/core';

class PlayerOperationError extends Error {
    constructor(code, message, cause, reason, selection) {
        super(message);
        this.cause = cause;
        this.reason = reason;
        this.selection = selection;
        this.name = 'PlayerOperationError';
        this.code = code;
    }
    toFailure() {
        return { code: this.code, message: this.message, cause: this.cause, ...(this.reason ? { reason: this.reason } : {}), ...(this.selection ? { selection: this.selection } : {}) };
    }
}
function knownSeconds(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
/**
 * Mirrors the Roku player's duration rule: the server-known title length is
 * authoritative, and only an original-file engine may raise it. A rolling
 * managed window therefore never becomes the seek bar's duration.
 */
function timelineDuration(authoritativeSeconds, engineSeconds, adoptEngineDuration = false) {
    const known = knownSeconds(authoritativeSeconds);
    if (!adoptEngineDuration)
        return known;
    const engine = knownSeconds(engineSeconds);
    if (known === null)
        return engine;
    return engine !== null && engine > known ? engine : known;
}
/** A native seek target inside the delivery: never negative, never past its end. */
function boundedPosition(position, duration) {
    if (!Number.isFinite(position) || position <= 0)
        return 0;
    return duration === null ? position : Math.min(position, duration);
}
/**
 * The seek bar's length only grows. Mirrors the Roku player, where a later or
 * re-read engine value can raise the known duration but never shorten it.
 */
function growOnlyDuration(previous, next) {
    if (next === null)
        return previous;
    if (previous === null)
        return next;
    return next > previous ? next : previous;
}
const EMPTY_TRACKS = {
    audio: [],
    text: [],
    selectedAudioId: null,
    selectedTextId: null,
};
const IDLE_SNAPSHOT = {
    sessionId: 0,
    state: 'idle',
    kind: null,
    time: { positionSeconds: 0, durationSeconds: null },
    tracks: EMPTY_TRACKS,
    error: null,
};

/** Validate source-only credentials before handing them to a platform engine. */
function checkedSourceAuthorization(input) {
    if (!input)
        return undefined;
    const headers = {};
    const seen = new Set();
    let cookie = input.cookie, userAgent = input.userAgent;
    const valid = (value) => typeof value === 'string' && value.length <= 8192 && !/[\u0000-\u001f\u007f]/.test(value);
    const invalid = () => new PlayerOperationError('authorization-failed', 'The source supplied invalid playback authorization.');
    if ((cookie !== undefined && !valid(cookie)) || (userAgent !== undefined && !valid(userAgent)) || Object.keys(input.headers ?? {}).length > 32)
        throw invalid();
    for (const [name, value] of Object.entries(input.headers ?? {})) {
        const key = name.toLowerCase();
        if (!/^[a-z0-9-]{1,128}$/i.test(name) || !valid(value) || seen.has(key)
            || ['host', 'connection', 'content-length', 'transfer-encoding', 'proxy-authorization', 'upgrade', 'keep-alive', 'te', 'trailer'].includes(key))
            throw invalid();
        seen.add(key);
        if (key === 'cookie') {
            if (cookie !== undefined && cookie !== value)
                throw invalid();
            cookie = value;
        }
        else if (key === 'user-agent') {
            if (userAgent !== undefined && userAgent !== value)
                throw invalid();
            userAgent = value;
        }
        else
            headers[name] = value;
    }
    return { ...(cookie ? { cookie } : {}), ...(userAgent ? { userAgent } : {}), ...(Object.keys(headers).length ? { headers } : {}) };
}
function hasSourceAuthorization(input) {
    const value = checkedSourceAuthorization(input);
    return !!(value?.cookie || value?.userAgent || Object.keys(value?.headers ?? {}).length);
}

/** Typed fetch failures must not hide permanent refusals from the demuxer's retry policy. */
function sessionMediaRetryDelay(direct) {
    return (attempts, error) => {
        if (error instanceof PlayerOperationError && (['authorization-failed', 'authorization-unsupported', 'expired-source', 'unsupported-format'].includes(error.code)
            || (direct && error.code === 'connection-failed')))
            return null;
        return Math.min(2 ** (attempts - 2), 16);
    };
}
/** The application supplies an authorized delivery, not an arbitrary proxy URL. */
function checkedMediaDelivery(value) {
    let url;
    try {
        url = new URL(value, location.href);
    }
    catch {
        throw new PlayerOperationError('authorization-unsupported', 'Invalid media delivery.');
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash
        || (location.protocol === 'https:' && url.protocol !== 'https:' && !('__TAURI_INTERNALS__' in window)))
        throw new PlayerOperationError('authorization-unsupported', 'This media delivery requires a secure gateway.');
    return url;
}
/** One delivery-origin/directory fence for files, manifests, segments and keys. */
function sessionMediaRequest(url, input, init) {
    const delivery = checkedMediaDelivery(url);
    const prefix = delivery.pathname.slice(0, delivery.pathname.lastIndexOf('/') + 1);
    const inherited = typeof input === 'string' || input instanceof URL ? undefined : input;
    const target = checkedMediaDelivery(new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, delivery).href);
    if (target.origin !== delivery.origin || !target.pathname.startsWith(prefix)
        || /%(?:2f|5c|25)/i.test(target.pathname))
        throw new PlayerOperationError('authorization-unsupported', 'The playlist contains a resource outside its playback session.');
    const method = (init?.method ?? inherited?.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD')
        throw new PlayerOperationError('authorization-unsupported', 'Media requests must be read-only.');
    // Media capabilities carry their own authority. Never forward a backend
    // bearer, cookies, an upstream credential, or a referring page URL.
    const supplied = new Headers(init?.headers ?? inherited?.headers);
    const headers = new Headers();
    for (const name of ['range', 'if-range', 'accept']) {
        const value = supplied.get(name);
        if (value !== null)
            headers.set(name, value);
    }
    return new Request(target.href, { method, headers, signal: init?.signal ?? inherited?.signal,
        credentials: 'omit', redirect: 'error', mode: 'cors', referrerPolicy: 'no-referrer' });
}
const TS_PACKET = 188, TS_SYNC = 0x47, TS_RUN = 5, SNIFF_LIMIT = 64 * 1024;
const MEDIA_BOXES = new Set(['ftyp', 'styp', 'moof', 'moov', 'sidx', 'emsg', 'prft']);
/**
 * Offset of the first MPEG-TS packet in `bytes`, or -1. IPTV CDNs disguise
 * segments as images or fonts by prepending a real PNG/JPEG/GIF header (or
 * other junk) to the transport stream, so a segment is classified by its
 * bytes, never by its name or Content-Type. A packet run must repeat at the
 * 188-byte stride; a short buffer that ends the run still needs three packets.
 */
function transportStreamOffset(bytes) {
    const scan = Math.min(bytes.length, SNIFF_LIMIT);
    for (let at = 0; at < scan; at++) {
        if (bytes[at] !== TS_SYNC)
            continue;
        let packets = 0;
        for (let i = at; i < bytes.length && bytes[i] === TS_SYNC && packets < TS_RUN; i += TS_PACKET)
            packets++;
        if (packets === TS_RUN || (packets >= 3 && at + packets * TS_PACKET >= bytes.length))
            return at;
    }
    return -1;
}
/** Leading bytes that already identify a real segment format stay untouched. */
function recognizedSegmentStart(head) {
    // 0x47 alone is also 'G' of a GIF disguise; a TS start repeats at the stride.
    if (head[0] === TS_SYNC && head[TS_PACKET] === TS_SYNC)
        return true;
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33)
        return true; // ID3-timestamped packed audio
    return head.length >= 8 && MEDIA_BOXES.has(String.fromCharCode(...head.subarray(4, 8)));
}
/** Reads a bounded head and drops a disguise prefix before the first TS packet. */
async function undisguisedBody(body) {
    const reader = body.getReader();
    const chunks = [];
    let length = 0, done = false;
    while (!done && length < SNIFF_LIMIT) {
        const next = await reader.read();
        if (next.done)
            done = true;
        else {
            chunks.push(next.value);
            length += next.value.length;
        }
        if (chunks.length && recognizedSegmentStart(chunks[0]))
            break;
    }
    const head = new Uint8Array(length);
    chunks.reduce((at, chunk) => { head.set(chunk, at); return at + chunk.length; }, 0);
    const found = recognizedSegmentStart(head) ? 0 : transportStreamOffset(head);
    const offset = Math.max(0, found);
    let pending = head.subarray(offset);
    return { offset, body: new ReadableStream({
            async pull(controller) {
                if (pending) {
                    const first = pending;
                    pending = null;
                    if (first.length) {
                        controller.enqueue(first);
                        return;
                    }
                }
                if (done) {
                    controller.close();
                    return;
                }
                try {
                    const next = await reader.read();
                    if (next.done)
                        controller.close();
                    else
                        controller.enqueue(next.value);
                }
                catch (cause) {
                    controller.error(cause);
                }
            },
            cancel(reason) { return reader.cancel(reason); },
        }) };
}
/** Byte positions after the disguise prefix map back to the stripped segment. */
function strippedHeaders(headers, offset) {
    const next = new Headers(headers);
    const length = Number(headers.get('content-length'));
    if (headers.has('content-length') && Number.isFinite(length))
        next.set('content-length', String(Math.max(0, length - offset)));
    const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(headers.get('content-range') ?? '');
    if (range)
        next.set('content-range', `bytes ${Math.max(0, Number(range[1]) - offset)}-${Number(range[2]) - offset}/${range[3] === '*' ? '*' : Number(range[3]) - offset}`);
    return next;
}
/** Nested resources stay inside the selected delivery even on another gateway. */
function sessionMediaFetch(url, observe) {
    const delivery = checkedMediaDelivery(url);
    // Segment URL -> bytes of disguise prefix removed from its first response;
    // later byte ranges of the same segment are shifted past that prefix.
    const disguised = new Map();
    let hls = delivery.pathname.endsWith('.m3u8');
    return async (input, init) => {
        const request = sessionMediaRequest(url, input, init);
        const target = new URL(request.url);
        const shift = disguised.get(target.href) ?? 0;
        const requested = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') ?? '');
        if (shift && requested)
            request.headers.set('range', `bytes=${Number(requested[1]) + shift}-${requested[2] ? Number(requested[2]) + shift : ''}`);
        const options = { method: request.method, headers: request.headers, signal: request.signal,
            credentials: request.credentials, redirect: request.redirect, referrerPolicy: request.referrerPolicy, mode: request.mode };
        let response;
        try {
            response = '__TAURI_INTERNALS__' in window
                ? await (await import('@tauri-apps/plugin-http')).fetch(target.href, { ...options, maxRedirections: 0 })
                : await fetch(target.href, options);
        }
        catch (cause) {
            if (request.signal.aborted)
                throw cause;
            throw new PlayerOperationError('connection-failed', 'Media connection failed.', undefined, 'network');
        }
        if (response.status === 401 || response.status === 403)
            throw new PlayerOperationError('authorization-failed', 'Media authorization was refused.', undefined, 'authorization');
        if (response.status === 410)
            throw new PlayerOperationError('expired-source', 'Media authorization expired.', undefined, 'authorization');
        if (response.status === 406)
            throw new PlayerOperationError('unsupported-format', 'This media needs a compatible delivery format.', undefined, 'container');
        if (!response.ok && response.status !== 416)
            throw new PlayerOperationError('connection-failed', 'Media could not be read. Retry playback.', undefined, 'network');
        const playlist = target.pathname.endsWith('.m3u8') || !!response.headers.get('content-type')?.includes('mpegurl');
        if (playlist)
            hls = true;
        if (playlist || !response.body || response.status === 416 || request.method !== 'GET')
            return response;
        let body = response.body, headers = response.headers;
        if (hls && (response.status === 200 || /^bytes 0-/.test(response.headers.get('content-range') ?? ''))) {
            // The body starts at the segment's first byte: classify it by content.
            const sniffed = await undisguisedBody(body);
            body = sniffed.body;
            if (sniffed.offset) {
                disguised.set(target.href, sniffed.offset);
                headers = strippedHeaders(headers, sniffed.offset);
            }
        }
        else if (shift)
            headers = strippedHeaders(headers, shift);
        if (!observe)
            return body === response.body && headers === response.headers ? response : new Response(body, { status: response.status, statusText: response.statusText, headers });
        const reader = body.getReader();
        let start = 0, bytes = 0;
        return new Response(new ReadableStream({
            async pull(controller) {
                if (!start)
                    start = performance.now();
                try {
                    const next = await reader.read();
                    if (next.done) {
                        if (bytes)
                            observe({ bytes, seconds: Math.max(0.001, (performance.now() - start) / 1000) });
                        controller.close();
                    }
                    else {
                        bytes += next.value.length;
                        controller.enqueue(next.value);
                    }
                }
                catch {
                    controller.error(new PlayerOperationError('connection-failed', 'Media body was interrupted.', undefined, 'network'));
                }
            },
            cancel(reason) { return reader.cancel(reason); },
        }), { status: response.status, statusText: response.statusText, headers });
    };
}

let policy = { clientInspection: false, localRemux: false };
/** Rollout switches are supplied by the host, never inferred from user agent. */
function configureBrowserPlayback(value) { policy = { ...policy, ...value }; }
function browserPlaybackPolicy() { return policy; }
function mediaFailure(cause, reason = 'container') {
    if (cause instanceof PlayerOperationError)
        return cause;
    if (cause instanceof DOMException && cause.name === 'NotAllowedError')
        return new PlayerOperationError('autoplay-blocked', 'Select Play to enable playback.', undefined, 'autoplay');
    if (cause instanceof TypeError)
        return new PlayerOperationError('connection-failed', 'Media could not be read. Retry playback.', undefined, 'network');
    return new PlayerOperationError('unsupported-format', 'This playback path cannot present the selected media.', undefined, reason);
}
function canChangeMediaPath(failure) {
    return ['unsupported-format', 'engine-unavailable', 'performance-limited'].includes(failure.code)
        && !['network', 'authorization', 'autoplay'].includes(failure.reason ?? '');
}

function playbackRequest(intent, capabilities, position) {
    if (intent.item.type === 'live')
        return { channelId: intent.item.id, position, capabilities };
    if (!intent.source)
        throw new Error('VOD playback requires an explicit source.');
    return { streamId: intent.source.id, position, capabilities };
}
function isOriginalDelivery(session) {
    return session.deliveryKind ? session.deliveryKind === 'direct' : session.mode === 'direct';
}
function adapterRequest(session, kind, position, paused) {
    const direct = isOriginalDelivery(session);
    const deliveryStart = kind === 'live' || direct ? 0
        : Math.max(0, session.timelineOffsetSeconds ?? session.position);
    const originalClock = direct || session.timelineOffsetSeconds === 0 && session.format === 'mp4';
    return {
        preferredAudioLanguage: session.preferredAudioLanguage,
        preferredSubtitleLanguage: session.preferredSubtitleLanguage,
        url: session.url,
        kind,
        startAtSeconds: kind === 'live' ? 0 : Math.max(0, position - deliveryStart),
        timelineOffsetSeconds: deliveryStart,
        // A managed delivery is a rolling window; only the session knows how long
        // the title is. Direct original files may refine it with their own length.
        timelineDurationSeconds: kind === 'live' || !(session.duration > 0) ? undefined : session.duration,
        adoptEngineDuration: originalClock,
        deliveryMode: direct ? 'direct' : 'managed',
        deliveryFormat: session.format,
        deliveryDecision: ['encode', 'transcode'].includes(session.videoMode) ? 'video-conversion'
            : ['encode', 'transcode'].includes(session.audioMode) ? 'audio-conversion' : direct ? 'original' : 'server-remux',
        paused,
        authorization: direct ? session.authorization : undefined,
    };
}
function itemKind(item) {
    return item.type === 'live' ? 'live' : 'vod';
}
/** A settled controller is 'playing' (including paused) unless the adapter failed. */
function playerState(player) {
    return player.snapshot.state === 'error' ? 'error' : 'playing';
}
function asError(cause) {
    return cause instanceof Error ? cause : new Error('Playback operation failed.');
}
/** The playback port reports refusals as Errors carrying an HTTP-like status. */
function refusalStatus(error) {
    if (!(error instanceof Error))
        return undefined;
    const { status } = error;
    return typeof status === 'number' ? status : undefined;
}
/**
 * A delivery refusal is answered with the next delivery rung for the same
 * source: original delivery, then managed output, then a forced transcode.
 * Only a server delivery refusal (406) escalates. Transport failures
 * (status 0) never convert media, and validation (400) and every other
 * answer keep their own meaning.
 */
function escalatePreparation(request, error) {
    const status = refusalStatus(error);
    if (status !== 406)
        return undefined;
    // A definitive source-format refusal cannot be repaired by converting its delivery.
    if (error instanceof Error && 'code' in error && error.code === 'source_format_unsupported')
        return undefined;
    if (!request.managedOnly)
        return { ...request, managedOnly: true };
    if (!request.forceTranscode)
        return { ...request, managedOnly: true, forceTranscode: true };
    return undefined;
}
/**
 * The retry request for a failed open or playback: the recovery rung plus the
 * failure's track selection and conversion reason, so the server converts
 * only what the device could not present.
 */
function failureRetryRequest(recovery, failure) {
    return { ...recovery, ...failure?.selection, ...(failure?.reason ? { conversionReason: failure.reason } : {}) };
}
/** Keep the selected source while escalating only after the cheaper rung fails. */
function recoveryRequest(session, request, code) {
    // A direct media origin may be unreachable from this client (for example
    // browser CORS). Try the authorized gateway once without forcing conversion.
    // A control-API outage or a failure of managed delivery never takes this path.
    if ((code === 'connection-failed' || code === 'authorization-unsupported') && isOriginalDelivery(session) && !request.managedOnly)
        return { ...request, managedOnly: true };
    // A missing engine (no AVPlay, no native plugin or engine, protocol
    // mismatch) is a host fact: no other delivery or conversion can fix it.
    if (code === 'engine-unavailable' || !canChangeMediaPath({ code }))
        return undefined;
    if (isOriginalDelivery(session) && !request.managedOnly)
        return { ...request, managedOnly: true };
    if (!isOriginalDelivery(session) && !request.forceTranscode)
        return { ...request, managedOnly: true, forceTranscode: true };
    return undefined;
}

/** Internal session gate: adapters call `isCurrent` from every async callback. */
class SessionPlayer {
    constructor() {
        this.listeners = new Set();
        this.currentSession = 0;
        this.nextSession = 0;
        this.currentSnapshot = IDLE_SNAPSHOT;
    }
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
            state: 'opening',
            kind,
            time: { positionSeconds: 0, durationSeconds: null },
            tracks: EMPTY_TRACKS,
            error: null,
        });
        return sessionId;
    }
    isCurrent(sessionId) {
        return this.currentSession === sessionId;
    }
    /** An operation outside a live session is a programming error, not a failure. */
    activeSessionOrThrow() {
        if (this.snapshot.sessionId === 0 || !this.isCurrent(this.snapshot.sessionId)) {
            throw new PlayerOperationError('invalid-state', 'No active playback session.');
        }
        return this.snapshot.sessionId;
    }
    /** Makes every previous callback inert. */
    invalidateSession() {
        this.currentSession = 0;
    }
    update(sessionId, patch) {
        if (!this.isCurrent(sessionId))
            return;
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
            error: null,
        });
    }
    fail(sessionId, error) {
        this.update(sessionId, { state: 'error', error });
    }
    publish(snapshot) {
        this.currentSnapshot = snapshot;
        for (const listener of this.listeners)
            listener(snapshot);
    }
}

/**
 * Coordinates the server's opaque playback session with one device adapter.
 * It never discovers or ranks a replacement source. On managed seeks/tracks it
 * starts one replacement for the same selected source and restores the old
 * session if the device cannot open the candidate.
 */
class PlaybackSessionController {
    nextOperation() {
        this.operationGeneration += 1;
        for (const [controller, wanted] of this.pendingStarts)
            if (!wanted())
                controller.abort();
        return this.operationGeneration;
    }
    async prepareSession(request, wanted) {
        const controller = new AbortController();
        this.pendingStarts.set(controller, wanted);
        if (!wanted())
            controller.abort();
        try {
            return await this.options.backend.startPlayback(request, { signal: controller.signal });
        }
        finally {
            this.pendingStarts.delete(controller);
        }
    }
    constructor(options) {
        this.options = options;
        this.listeners = new Set();
        this.current = null;
        this.nextGeneration = 0;
        this.operationGeneration = 0;
        this.pendingStarts = new Map();
        this.activePlayerSessionId = 0;
        this.pausedPlayerSessionId = 0;
        this.recoveredSessions = new Set();
        /** The one next-operation Back is allowed to restore after adapter open. */
        this.restoreRequestedOperation = null;
        this.currentSnapshot = { state: 'idle', active: null, error: null };
    }
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
            const retirement = Promise.allSettled([closing, releasing]).then(() => undefined);
            this.retiringPresentation = retirement;
            void retirement.then(() => { if (this.retiringPresentation === retirement)
                this.retiringPresentation = undefined; });
        }
        this.publish({ state: this.current ? 'replacing' : 'opening', active: this.current, error: null });
        try {
            await this.retiringPresentation;
            if (operation !== this.operationGeneration)
                return this.cancelledResult();
            const capabilities = await this.resolveCapabilities();
            if (operation !== this.operationGeneration)
                return this.cancelledResult();
            let request = playbackRequest(intent, capabilities, intent.position ?? 0);
            // A delivery refusal (406) escalates the same selected source through
            // the shared delivery ladder (at most two rungs) before giving up, so
            // one inspection refusal cannot strand a source the server can still
            // deliver. Transport failures (status 0) are surfaced, never converted.
            for (let attempt = 0;; attempt += 1) {
                try {
                    return await this.transition(intent, request, this.current, () => operation === this.operationGeneration, () => false);
                }
                catch (error) {
                    if (operation !== this.operationGeneration)
                        return this.cancelledResult();
                    // Native direct is preferred, but an authorized gateway may deliver
                    // an otherwise unsupported source. The backend enforces grants.
                    const escalated = attempt < 2
                        ? escalatePreparation(request, error)
                        : undefined;
                    if (!escalated)
                        throw error;
                    request = escalated;
                }
            }
        }
        catch (error) {
            if (operation !== this.operationGeneration)
                return this.cancelledResult();
            this.publish({ state: this.current ? 'playing' : 'error', active: this.current,
                error: error instanceof Error ? error : new Error(String(error)) });
            throw error;
        }
    }
    /** Observe the actual adapter snapshot, including decoder failures after open. */
    async recoverPlayback(snapshot) {
        if (snapshot.sessionId !== this.options.player.snapshot.sessionId)
            return true;
        if (snapshot.state === 'paused')
            this.pausedPlayerSessionId = snapshot.sessionId;
        else if (snapshot.state === 'playing')
            this.pausedPlayerSessionId = 0;
        if (!snapshot.error)
            return false;
        // Preparation already owns adapter failures and the bounded initial retry.
        if (['opening', 'replacing', 'preparing-next'].includes(this.currentSnapshot.state))
            return true;
        const active = this.current;
        if (!active || snapshot.sessionId !== this.activePlayerSessionId)
            return true;
        const recovery = this.options.backend.canConvertPlayback?.(active.session.id) === false ? undefined : recoveryRequest(active.session, active.request, snapshot.error.code);
        const request = recovery ? failureRetryRequest(recovery, snapshot.error) : undefined;
        if (!request || this.recoveredSessions.has(active.session.id))
            return false;
        this.recoveredSessions.add(active.session.id);
        this.cancelNext(false);
        const operation = this.nextOperation();
        const position = active.intent.item.type === 'live' ? 0 : snapshot.time.positionSeconds;
        const paused = this.pausedPlayerSessionId === snapshot.sessionId;
        await this.transition({ ...active.intent, position }, { ...request, position }, active, () => operation === this.operationGeneration, () => false, { position, paused });
        return true;
    }
    async seek(position) {
        this.cancelNext(false);
        const operation = this.nextOperation();
        const active = this.requireActive();
        if (!Number.isFinite(position) || position < 0)
            throw new Error('Seek position must be a non-negative number.');
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
        if (!Number.isFinite(position) || position < 0)
            throw new Error('Seek position must be a non-negative number.');
        // Read the live position after this operation still owns the controller;
        // startPlayback is the first await, so the read is neither stale nor racy.
        const stillWanted = () => operation === this.operationGeneration;
        const request = { ...active.request, position };
        await this.transition({ ...active.intent, position }, request, active, stillWanted, () => stillWanted(), { position: currentPosition(), paused: this.options.player.snapshot.state === 'paused' });
    }
    async replaceTracks(selection) {
        this.cancelNext(false);
        const operation = this.nextOperation();
        const active = this.requireActive();
        const position = this.options.player.snapshot.time.positionSeconds;
        const request = { ...active.request, position, ...selection,
            ...(!isOriginalDelivery(active.session) ? { managedOnly: true } : {}),
            ...(selection.subtitlesOff ? { subtitleTrackIndex: undefined } : {}) };
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
        this.publish({ state: 'preparing-next', active, error: null });
        try {
            const next = await resolveNext();
            if (generation !== this.nextGeneration)
                return;
            if (!next) {
                this.publish({ state: playerState(this.options.player), active: this.current, error: null });
                return;
            }
            const capabilities = await this.resolveCapabilities();
            if (generation !== this.nextGeneration || operation !== this.operationGeneration)
                return;
            const request = playbackRequest(next, capabilities, next.position ?? 0);
            await this.transition(next, request, active, () => generation === this.nextGeneration && operation === this.operationGeneration, () => this.restoreRequestedOperation === operation);
        }
        catch (cause) {
            if (generation !== this.nextGeneration)
                return;
            const error = asError(cause);
            this.publish({ state: 'error', active: this.current, error });
            throw error;
        }
        finally {
            if (this.restoreRequestedOperation === operation)
                this.restoreRequestedOperation = null;
        }
    }
    /**
     * Back requests restoration if AVPlay/HTML media has already switched to a
     * next candidate. Internal replacement and stop callers pass false: their
     * newer operation owns the adapter and an old operation must stay inert.
     */
    cancelNext(restoreOutgoing = true) {
        if (!restoreOutgoing)
            this.restoreRequestedOperation = null;
        else if (this.currentSnapshot.state === 'preparing-next' || this.currentSnapshot.state === 'replacing') {
            this.restoreRequestedOperation = this.operationGeneration;
        }
        this.nextGeneration += 1;
        if (this.currentSnapshot.state === 'preparing-next' || this.currentSnapshot.state === 'replacing') {
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
        this.publish({ state: 'stopped', active: null, error: null });
        const retirement = this.retiringPresentation;
        // A native decoder close can stall or fail. Begin lease release before
        // waiting for it so shutdown does not strand a server reservation.
        const releasing = active ? this.options.backend.stopPlayback(active.session.id) : Promise.resolve();
        // Native HTTP IPC may share the decoder's UI thread. Application exit
        // must finish that release while the thread can still dispatch replies.
        const released = options.releaseBeforePlayer ? await Promise.allSettled([releasing]) : [];
        const nativeStop = !options.releaseBeforePlayer || operation === this.operationGeneration
            ? this.options.player.stop() : Promise.resolve();
        const stopped = await Promise.allSettled([nativeStop, retirement, ...(options.releaseBeforePlayer ? [] : [releasing])]);
        const failed = [...stopped, ...released].find(result => result.status === 'rejected');
        if (failed?.status === 'rejected')
            throw failed.reason;
        if (operation === this.operationGeneration)
            this.publish({ state: 'stopped', active: null, error: null });
    }
    async transition(intent, request, previous, stillWanted = () => true, restoreOnCancellation = () => false, previousState) {
        const startupStarted = performance.now();
        const wasPaused = previousState?.paused ?? this.options.player.snapshot.state === 'paused';
        const previousPosition = previousState?.position ?? this.options.player.snapshot.time.positionSeconds;
        this.publish({ state: previous ? 'replacing' : 'opening', active: previous, error: null });
        let session;
        try {
            session = await this.prepareSession(request, stillWanted);
        }
        catch (cause) {
            if (!stillWanted())
                return this.cancelledResult();
            const error = asError(cause);
            this.publish({ state: 'error', active: this.current, error });
            throw error;
        }
        if (!stillWanted()) {
            await this.options.backend.stopPlayback(session.id);
            return this.cancelledResult();
        }
        // The backend session this transition still owns. It is cleared before
        // each stop so a failure path never stops the same session twice, and
        // once the candidate becomes current.
        let owned = session;
        const releaseOwned = async () => {
            const released = owned;
            owned = undefined;
            if (released)
                await this.options.backend.stopPlayback(released.id);
        };
        try {
            for (;;) {
                try {
                    const suppliedBudget = await this.options.backend.remainingStartupBudget?.(session.id);
                    const budget = suppliedBudget === undefined ? undefined : Math.min(suppliedBudget, 120_000 - (performance.now() - startupStarted));
                    if (budget !== undefined && (!Number.isFinite(budget) || budget <= 0))
                        throw new PlayerOperationError('prepare-failed', 'Playback startup timed out.');
                    await this.options.player.open({ ...adapterRequest(session, itemKind(intent.item), request.position ?? 0, wasPaused), startupBudgetMs: budget });
                    break;
                }
                catch (cause) {
                    if (!(cause instanceof PlayerOperationError))
                        throw cause;
                    const recovery = this.options.backend.canConvertPlayback?.(session.id) === false ? undefined : recoveryRequest(session, request, cause.code);
                    if (!stillWanted() || !recovery)
                        throw cause;
                    await releaseOwned();
                    if (!stillWanted())
                        throw new DOMException('Playback operation was cancelled.', 'AbortError');
                    request = failureRetryRequest(recovery, cause);
                    session = await this.prepareSession(request, stillWanted);
                    owned = session;
                    if (!stillWanted())
                        throw new DOMException('Playback operation was cancelled.', 'AbortError');
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
            owned = undefined;
            this.activePlayerSessionId = this.options.player.snapshot.sessionId;
            // A cleanup failure leaks a backend session but must never undo a
            // candidate already proven playable on the device.
            if (previous)
                await this.options.backend.stopPlayback(previous.session.id).catch(() => undefined);
            this.publish({ state: playerState(this.options.player), active: candidate, error: null });
            return candidate;
        }
        catch (cause) {
            const error = asError(cause);
            await releaseOwned().catch(() => undefined);
            const shouldRestore = () => stillWanted() || restoreOnCancellation();
            if (shouldRestore()) {
                try {
                    await this.restore(previous, previousPosition, wasPaused, shouldRestore);
                }
                catch {
                    this.current = null;
                    await this.options.player.stop().catch(() => undefined);
                    if (previous)
                        await this.options.backend.stopPlayback(previous.session.id).catch(() => undefined);
                }
            }
            if (!stillWanted())
                return this.cancelledResult();
            this.publish({ state: 'error', active: this.current, error });
            throw error;
        }
    }
    async restore(previous, position, paused, stillRestore = () => true) {
        if (!previous) {
            this.current = null;
            return;
        }
        if (!stillRestore())
            return;
        await this.options.player.open(adapterRequest(previous.session, itemKind(previous.intent.item), position, paused));
        if (!stillRestore())
            return;
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
        throw new DOMException('Playback operation was cancelled.', 'AbortError');
    }
    async resolveCapabilities() {
        return typeof this.options.capabilities === 'function'
            ? this.options.capabilities() : this.options.capabilities;
    }
    requireActive() {
        if (!this.current)
            throw new Error('No active playback session.');
        return this.current;
    }
    publish(snapshot) {
        this.currentSnapshot = snapshot;
        for (const listener of this.listeners)
            listener(snapshot);
    }
}

/** Internal helpers shared by adapters; not part of the package API. */
/** ISO language matching without importing browser demux/track machinery. */
const mediaLanguage = (language) => ({ en: 'eng', es: 'spa', fr: 'fra', de: 'deu', it: 'ita', pt: 'por', ja: 'jpn', ko: 'kor', zh: 'zho', hi: 'hin', ar: 'ara' }[language.split('-')[0]] ?? language);
function supportsNativeHls(media) {
    return ['application/vnd.apple.mpegurl', 'application/x-mpegURL'].some(type => {
        try {
            return !!media.canPlayType?.(type);
        }
        catch {
            return false;
        }
    });
}
/** A finite positive value, otherwise zero. */
function nonNegative(value) {
    return Number.isFinite(value) && value > 0 ? value : 0;
}
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Presentation of the selected output; input indices belong to the server. */
function subtitleIntent(request, tracks) {
    if (request.textTrackId === null)
        return null;
    if (request.textTrackId !== undefined)
        return tracks.find(track => track.id === request.textTrackId && track.available)?.id;
    if (!request.preferredSubtitleLanguage)
        return undefined;
    const language = mediaLanguage(request.preferredSubtitleLanguage.toLowerCase());
    return tracks.find(track => track.available && track.language && mediaLanguage(track.language.toLowerCase()) === language)?.id
        ?? (request.deliveryMode === 'managed' && tracks.length === 1 && tracks[0].available &&
            (!tracks[0].language || tracks[0].language === 'und' || language === 'und') ? tracks[0].id : undefined);
}

const VIZIO_HTML5_CAPABILITIES = {
    platform: 'vizio',
    engine: 'HTMLMediaElement',
    directNative: 'probe-required',
    adaptiveStreaming: 'probe-required',
    drm: 'probe-required',
    canSetVolume: true,
    canPause: true,
    canSeek: true,
    canSelectAudioTrack: false,
    canSelectTextTrack: true,
    canDisableTextTrack: true,
    canUseCookies: false,
    canUseUserAgent: false,
    limitations: [
        'No public Vizio playback capability table is assumed; test the exact TV, firmware, source and duration.',
        'This adapter does not set request headers, cookies or audio tracks. Supply a backend-compatible signed/direct URL.',
        'HLS uses native playback first, then hls.js/MSE transmuxing when supported; WebCodecs is not a decoder path.',
        'Adaptive, DRM, seek and subtitle behavior are runtime probes, not platform-wide claims.',
    ],
};
/**
 * Vizio SmartCast uses the browser-native path. It owns no delivery fallback:
 * the backend selects direct/copy/remux/audio/full transcode before this URL is
 * handed to the adapter and records the selected rung.
 */
class VizioHtml5Adapter extends SessionPlayer {
    get capabilities() { return { ...VIZIO_HTML5_CAPABILITIES, canSelectAudioTrack: !!this.hls || !!this.media.audioTracks?.length }; }
    constructor(media, options = {}) {
        super();
        this.media = media;
        this.options = options;
        this.hls = null;
        this.expectedVideo = true;
        this.controlGeneration = 0;
        this.frameObservationGeneration = 0;
        this.videoFrameProgress = 'unavailable';
        this.frameProgressVerified = false;
        this.nativeHlsFallback = null;
        this.pauseRequested = false;
        this.activeKind = null;
        this.timelineOffsetSeconds = 0;
        this.adoptEngineDuration = false;
        this.observedTitleDuration = null;
        this.textTrackAdded = () => this.onMetadata();
        this.pendingOpen = null;
        this.handlers = {
            volumechange: () => this.onVolume(),
            loadedmetadata: () => this.onMetadata(),
            canplay: () => this.onCanPlay(),
            play: () => this.onPlay(),
            pause: () => this.onPause(),
            waiting: () => this.onWaiting(),
            playing: () => this.onPlay(),
            seeking: () => this.resetProgressObservation(),
            timeupdate: () => this.onTimeUpdate(),
            progress: () => this.onProgress(),
            ended: () => this.onEnded(),
            error: () => this.onError(),
        };
        for (const [event, handler] of Object.entries(this.handlers))
            this.media.addEventListener(event, handler);
        this.media.textTracks?.addEventListener?.('addtrack', this.textTrackAdded);
    }
    open(request) {
        clearTimeout(this.subtitleTimer);
        try {
            checkedMediaDelivery(request.url);
        }
        catch (error) {
            return Promise.reject(error);
        }
        if (hasSourceAuthorization(request.authorization)) {
            return Promise.reject(new PlayerOperationError('authorization-unsupported', 'The Vizio HTML player cannot attach credentials. Use a backend-compatible URL instead.'));
        }
        this.nativeHlsFallback = null;
        this.controlGeneration++;
        this.stopMediaObservation();
        this.clearFirstFrameWatchdog();
        this.cancelPendingOpen();
        this.destroyHls();
        this.invalidateSession();
        this.pauseRequested = request.paused ?? false;
        this.expectedVideo = request.expectedVideo !== false;
        this.resetProgressObservation();
        this.frameProgressVerified = false;
        this.presentedFrame = undefined;
        this.frameObservation = undefined;
        this.videoFrameProgress = 'unavailable';
        this.startupDeadline = request.startupBudgetMs === undefined ? undefined : performance.now() + Math.max(0, Math.min(120_000, request.startupBudgetMs));
        const sessionId = this.startSession(request.kind);
        this.update(sessionId, { diagnostics: { decision: request.deliveryDecision, engine: 'native-html', networkTransport: new URL(request.url, location.href).pathname.startsWith('/media/') ? 'browser-proxy' : 'direct', transport: /\.m3u8(?:[?#]|$)/i.test(request.url) ? 'hls' : 'file' }, volume: { level: this.media.volume ?? 1, muted: this.media.muted ?? false } });
        this.activeKind = request.kind;
        this.timelineOffsetSeconds = nonNegative(request.timelineOffsetSeconds ?? 0);
        this.timelineDurationSeconds = request.timelineDurationSeconds;
        this.adoptEngineDuration = request.adoptEngineDuration === true;
        this.observedTitleDuration = null;
        this.subtitleRequest = request;
        this.media.pause();
        this.media.crossOrigin = 'anonymous';
        return new Promise((resolve, reject) => {
            let openingTimer;
            let targetPosition = request.startAtSeconds ?? 0;
            let attempt = 0;
            const cleanup = () => {
                clearTimeout(openingTimer);
                this.media.removeEventListener('loadedmetadata', onReady);
                this.media.removeEventListener('error', onFailure);
            };
            const onReady = () => {
                if (!this.isCurrent(sessionId)) {
                    cleanup();
                    resolve();
                    return;
                }
                cleanup();
                const readyAttempt = attempt;
                this.watchFirstFrame(sessionId);
                const target = request.kind === 'live'
                    ? Math.max(0, this.hls?.liveSyncPosition ?? this.media.currentTime ?? 0)
                    : boundedPosition(targetPosition, knownDuration(this.media.duration));
                try {
                    this.resetProgressObservation();
                    this.media.currentTime = target;
                }
                catch { /* browser may delay seek until a later ready state */ }
                this.update(sessionId, {
                    state: this.pauseRequested ? 'paused' : 'ready',
                    time: { positionSeconds: this.timelineOffsetSeconds + target, durationSeconds: this.titleDuration() },
                    tracks: this.tracks(),
                    error: null,
                });
                if (!this.hls && request.preferredSubtitleLanguage && request.textTrackId !== null) {
                    clearTimeout(this.subtitleTimer);
                    this.subtitleTimer = setTimeout(() => {
                        // A native HLS MIME hint does not establish WebVTT rendition
                        // support. Retry the same URL with MSE if no text track appeared.
                        if (this.isCurrent(sessionId) && this.subtitleRequest && !this.hls && !this.tracks().text.length)
                            this.nativeHlsFallback?.(true);
                    }, 750);
                }
                if (this.pauseRequested) {
                    this.media.pause();
                    this.pendingOpen = null;
                    resolve();
                    return;
                }
                this.media.play().then(() => { if (this.isCurrent(sessionId) && readyAttempt === attempt) {
                    this.pendingOpen = null;
                    resolve();
                } }, (cause) => {
                    if (!this.isCurrent(sessionId))
                        return resolve();
                    if (readyAttempt !== attempt)
                        return;
                    if (this.snapshot.state === 'error' && this.snapshot.error) {
                        const failure = this.snapshot.error;
                        reject(new PlayerOperationError(failure.code, failure.message, cause, failure.reason, failure.selection));
                        return;
                    }
                    if (this.nativeHlsFallback?.())
                        return;
                    const error = this.media.error ? mediaError(this.media, 'prepare-failed')
                        : new PlayerOperationError('prepare-failed', 'The browser could not start the selected source.', cause);
                    this.fail(sessionId, error.toFailure());
                    reject(error);
                });
            };
            const onFailure = () => {
                // load() clears an obsolete native error while the same dispatch is
                // switching to MSE. That old event must not reject the new attempt.
                if (!this.media.error)
                    return;
                if (this.nativeHlsFallback?.())
                    return;
                if (!this.isCurrent(sessionId)) {
                    cleanup();
                    resolve();
                    return;
                }
                cleanup();
                const error = mediaError(this.media, 'prepare-failed');
                this.nativeHlsFallback = null;
                this.destroyHls();
                this.fail(sessionId, error.toFailure());
                this.pendingOpen = null;
                reject(error);
            };
            // Metadata is the earliest portable point at which the resume target and
            // finite VOD duration are meaningful. Old TV browsers need not emit the
            // later canplay event before play() is allowed.
            this.media.addEventListener('loadedmetadata', onReady);
            this.media.addEventListener('error', onFailure);
            this.pendingOpen = { sessionId, cancel: () => { cleanup(); resolve(); } };
            const failOpen = (error) => {
                if (!this.isCurrent(sessionId))
                    return;
                cleanup();
                this.pendingOpen = null;
                this.nativeHlsFallback = null;
                this.destroyHls();
                this.fail(sessionId, error.toFailure());
                reject(error);
            };
            openingTimer = setTimeout(() => failOpen(new PlayerOperationError('prepare-failed', 'The selected source did not become ready in time.')), this.startupDeadline === undefined ? 20000 : Math.max(1, Math.min(20000, this.startupDeadline - performance.now())));
            const startMse = () => {
                this.update(sessionId, { diagnostics: { decision: request.deliveryDecision, engine: 'hls.js', networkTransport: 'browser-proxy', transport: 'hls' } });
                if (!Hls.isSupported())
                    throw new PlayerOperationError('unsupported-format', 'This browser cannot play HLS. Native HLS or MediaSource support is required.');
                const url = checkedMediaDelivery(request.url);
                const hls = new Hls({
                    // A 2016-2020 SmartCast TV's Wi-Fi commonly sustains ~5-10 Mbps with
                    // 150 ms latency; at a 4 Mbps rendition the previous 20 s forward
                    // window drained during single-segment hiccups and rebuffered every
                    // few seconds. 45 s forward (75 s hard ceiling) rides out transcode
                    // pacing jitter at ~20 MB RAM on this device class; the 30 s back
                    // buffer keeps seeks cheap.
                    maxBufferLength: 45,
                    maxMaxBufferLength: 75,
                    backBufferLength: 30,
                    maxBufferSize: 60 * 1000 * 1000,
                    loader: FetchLoader,
                    fetchSetup: (context, init) => sessionMediaRequest(url.href, context.url, init),
                });
                this.hls = hls;
                if (request.textTrackId === null)
                    hls.subtitleDisplay = false;
                // Consecutive non-fatal network failures stall the video silently
                // (buffer drains, spinner forever). hls.js keeps retrying internally,
                // so three in a row with no successful load in between escalates to a
                // classified error the UI can surface; any successful load resets it.
                let consecutiveNetworkFailures = 0;
                const publishTracks = () => {
                    if (!this.isCurrent(sessionId))
                        return;
                    this.update(sessionId, { tracks: this.tracks(), qualities: (hls.levels ?? []).map((level, index) => ({
                            id: `hls:${index}`, label: `${level.height}p`, width: level.width, height: level.height, bitrate: level.bitrate,
                        })), selectedQualityId: hls.autoLevelEnabled ? 'auto' : `hls:${hls.currentLevel}` });
                    // hls.js finishes its own default selection after dispatching the
                    // track-list event. Apply the server intent once that stack returns.
                    void Promise.resolve().then(() => {
                        if (this.isCurrent(sessionId) && this.hls === hls)
                            this.applySubtitleIntent();
                    });
                };
                hls.on(Hls.Events.MANIFEST_PARSED, publishTracks);
                hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, publishTracks);
                hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, publishTracks);
                hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, publishTracks);
                hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, publishTracks);
                hls.on(Hls.Events.LEVEL_UPDATED, () => { consecutiveNetworkFailures = 0; });
                hls.on(Hls.Events.FRAG_LOADED, () => { consecutiveNetworkFailures = 0; });
                hls.on(Hls.Events.ERROR, (_event, data) => {
                    if (!this.isCurrent(sessionId))
                        return;
                    if (!data.fatal && data.response?.code !== 406) {
                        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && ++consecutiveNetworkFailures >= 3) {
                            failOpen(new PlayerOperationError('connection-failed', 'The stream connection kept failing. Retry playback or choose another source.', undefined, 'network'));
                        }
                        return;
                    }
                    failOpen(new PlayerOperationError(data.response?.code === 406 ? 'unsupported-format' : data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'connection-failed' : 'unsupported-format', 'The selected HLS source could not be played.', undefined, data.response?.code === 406 ? 'container' : undefined));
                });
                hls.attachMedia(this.media);
                hls.loadSource(url.href);
            };
            try {
                const isHls = /\.m3u8(?:[?#]|$)/i.test(request.url);
                if (isHls && !supportsNativeHls(this.media))
                    startMse();
                else {
                    if (isHls && Hls.isSupported()) {
                        // A native MIME hint is not decode evidence. Some Chromium builds
                        // advertise HLS, then reject valid MPEG-TS playlists after metadata.
                        // Retry that exact capability locally once, before server escalation.
                        this.nativeHlsFallback = (stalled = false) => {
                            if (!this.isCurrent(sessionId) || !stalled && ![3, 4].includes(this.media.error?.code ?? 0))
                                return false;
                            this.nativeHlsFallback = null;
                            this.controlGeneration++;
                            this.stopMediaObservation();
                            this.clearFirstFrameWatchdog();
                            this.resetProgressObservation();
                            this.frameProgressVerified = false;
                            this.presentedFrame = undefined;
                            attempt++;
                            if (request.kind !== 'live' && Number.isFinite(this.media.currentTime) && this.media.currentTime > 0)
                                targetPosition = this.media.currentTime;
                            cleanup();
                            this.media.removeAttribute?.('src');
                            this.media.load();
                            this.update(sessionId, { state: 'buffering', error: null });
                            this.media.addEventListener('loadedmetadata', onReady);
                            this.media.addEventListener('error', onFailure);
                            this.pendingOpen = { sessionId, cancel: () => { cleanup(); resolve(); } };
                            openingTimer = setTimeout(() => failOpen(new PlayerOperationError('prepare-failed', 'The selected source did not become ready in time.')), this.startupDeadline === undefined ? 20000 : Math.max(1, Math.min(20000, this.startupDeadline - performance.now())));
                            try {
                                startMse();
                            }
                            catch (cause) {
                                failOpen(cause instanceof PlayerOperationError ? cause : new PlayerOperationError('prepare-failed', 'The browser could not prepare the selected source.', cause));
                            }
                            return true;
                        };
                        // A native HLS engine may stall before loadedmetadata, so the
                        // decoded-frame watchdog has not started yet. Give this MIME
                        // hint the same eight-second discovery bound, then try MSE once.
                        clearTimeout(openingTimer);
                        openingTimer = setTimeout(() => {
                            if (this.startupDeadline === undefined || performance.now() < this.startupDeadline) {
                                if (this.nativeHlsFallback?.(true))
                                    return;
                            }
                            failOpen(new PlayerOperationError('prepare-failed', 'The selected source did not become ready in time.'));
                        }, this.startupDeadline === undefined ? 8000 : Math.max(1, Math.min(8000, this.startupDeadline - performance.now())));
                    }
                    this.media.src = request.url;
                    this.media.load();
                }
            }
            catch (cause) {
                failOpen(cause instanceof PlayerOperationError ? cause : new PlayerOperationError('prepare-failed', 'The browser could not prepare the selected source.', cause));
            }
        });
    }
    async play() {
        const sessionId = this.activeSessionOrThrow();
        const control = ++this.controlGeneration;
        this.pauseRequested = false;
        try {
            await this.media.play();
            if (!this.isCurrent(sessionId) || control !== this.controlGeneration)
                return;
            this.startMediaObservation(sessionId);
            this.watchFirstFrame(sessionId);
            this.update(sessionId, { state: 'playing', error: null });
        }
        catch (cause) {
            if (!this.isCurrent(sessionId) || control !== this.controlGeneration)
                return;
            const error = mediaFailure(cause);
            this.fail(sessionId, error.toFailure());
            throw error;
        }
    }
    async pause() {
        this.controlGeneration++;
        this.pauseRequested = true;
        this.stopMediaObservation();
        this.clearFirstFrameWatchdog();
        const sessionId = this.activeSessionOrThrow();
        this.media.pause();
        this.onTimeUpdate();
        this.update(sessionId, { state: 'paused' });
    }
    async seek(positionSeconds) {
        const sessionId = this.activeSessionOrThrow();
        if (this.activeKind === 'live')
            throw new PlayerOperationError('unsupported-operation', 'Live playback does not expose VOD seeking.');
        if (!Number.isFinite(positionSeconds) || positionSeconds < 0)
            throw new PlayerOperationError('seek-failed', 'Seek position must be a non-negative number.');
        try {
            const target = boundedPosition(positionSeconds - this.timelineOffsetSeconds, knownDuration(this.media.duration));
            this.resetProgressObservation();
            this.media.currentTime = target;
            this.update(sessionId, { time: { positionSeconds: this.timelineOffsetSeconds + target, durationSeconds: this.titleDuration() } });
        }
        catch (cause) {
            const error = new PlayerOperationError('seek-failed', 'The browser could not seek the selected source.', cause);
            this.fail(sessionId, error.toFailure());
            throw error;
        }
    }
    async stop() {
        clearTimeout(this.subtitleTimer);
        this.subtitleRequest = undefined;
        this.nativeHlsFallback = null;
        this.controlGeneration++;
        this.stopMediaObservation();
        this.clearFirstFrameWatchdog();
        this.cancelPendingOpen();
        this.destroyHls();
        this.invalidateSession();
        this.activeKind = null;
        this.media.pause();
        this.media.removeAttribute?.('src');
        this.media.load();
        this.terminal('stopped');
    }
    async dispose() {
        await this.stop();
        this.media.textTracks?.removeEventListener?.('addtrack', this.textTrackAdded);
        for (const [event, handler] of Object.entries(this.handlers))
            this.media.removeEventListener(event, handler);
        this.terminal('disposed');
    }
    async selectAudioTrack(id) {
        if (!this.hls) {
            const index = /^audio:(\d+)$/.exec(id)?.[1];
            const tracks = Array.from(this.media.audioTracks ?? []);
            if (index === undefined || !tracks[Number(index)])
                throw new PlayerOperationError('unsupported-operation', 'This audio track is unavailable.');
            tracks.forEach((track, at) => { track.enabled = at === Number(index); });
            this.update(this.snapshot.sessionId, { tracks: this.tracks() });
            return;
        }
        const index = /^hls-audio:(\d+)$/.exec(id)?.[1];
        if (!this.hls || index === undefined || !this.hls.audioTracks[Number(index)])
            throw new PlayerOperationError('unsupported-operation', 'This audio track is unavailable.');
        this.hls.audioTrack = Number(index);
        this.update(this.snapshot.sessionId, { tracks: this.tracks() });
    }
    async selectQuality(id) {
        if (!this.hls)
            throw new PlayerOperationError('unsupported-operation', 'Quality selection is unavailable.');
        const index = id === 'auto' ? -1 : Number(/^hls:(\d+)$/.exec(id)?.[1]);
        if (!Number.isInteger(index) || index < -1 || index >= this.hls.levels.length)
            throw new PlayerOperationError('unsupported-operation', 'Quality is unavailable.');
        this.hls.currentLevel = index;
        this.update(this.snapshot.sessionId, { selectedQualityId: id });
    }
    tracks() {
        if (!this.hls)
            return tracksFromMedia(this.media);
        return {
            audio: (this.hls.audioTracks ?? []).map((track, index) => ({ id: `hls-audio:${index}`, label: track.name || track.lang || `Audio ${index + 1}`, language: track.lang, available: true })),
            text: (this.hls.subtitleTracks ?? []).map((track, index) => ({ id: `hls-text:${index}`, label: track.name || track.lang || `Subtitle ${index + 1}`, language: track.lang, available: true })),
            selectedAudioId: this.hls.audioTrack >= 0 ? `hls-audio:${this.hls.audioTrack}` : null,
            selectedTextId: this.hls.subtitleTrack >= 0 ? `hls-text:${this.hls.subtitleTrack}` : null,
        };
    }
    async selectTextTrack(trackId) {
        clearTimeout(this.subtitleTimer);
        this.subtitleRequest = undefined;
        const sessionId = this.activeSessionOrThrow();
        if (this.hls) {
            const index = trackId === null ? -1 : Number(/^hls-text:(\d+)$/.exec(trackId)?.[1]);
            if (!Number.isInteger(index) || index < -1 || index >= this.hls.subtitleTracks.length)
                throw new PlayerOperationError('unsupported-operation', 'Subtitle is unavailable.');
            this.hls.subtitleTrack = index;
            this.hls.subtitleDisplay = index >= 0;
            this.update(sessionId, { tracks: this.tracks() });
            return;
        }
        const tracks = selectableTextTracks(this.media);
        if (trackId === null) {
            for (const { track } of tracks)
                track.mode = 'disabled';
            this.update(sessionId, { tracks: { ...this.snapshot.tracks, selectedTextId: null } });
            return;
        }
        const selected = tracks.find((entry) => entry.id === trackId);
        if (!selected)
            throw new PlayerOperationError('unsupported-operation', `Subtitle track ${trackId} is not available.`);
        for (const { track } of tracks)
            track.mode = track === selected.track ? 'showing' : 'disabled';
        this.update(sessionId, { tracks: { ...tracksFromMedia(this.media), selectedTextId: trackId } });
    }
    async setVolume(level) {
        this.media.volume = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 1));
        if (this.media.volume > 0)
            this.media.muted = false;
        this.onVolume();
    }
    async setMuted(muted) { this.media.muted = muted; this.onVolume(); }
    onVolume() { this.update(this.snapshot.sessionId, { volume: { level: this.media.volume ?? 1, muted: this.media.muted ?? false } }); }
    clearFirstFrameWatchdog() {
        clearTimeout(this.firstFrameTimer);
        this.firstFrameTimer = undefined;
    }
    startMediaObservation(sessionId) {
        this.observePresentedFrames(sessionId);
        if (!this.options.unreliableFrameReporting || this.mediaPoll || this.pauseRequested)
            return;
        this.mediaPoll = setInterval(() => {
            if (!this.isCurrent(sessionId) || this.media.paused || this.media.ended || this.media.error) {
                this.stopMediaObservation();
                return;
            }
            this.onTimeUpdate();
        }, 250);
    }
    observePresentedFrames(sessionId) {
        if (!this.media.requestVideoFrameCallback || this.frameCallback !== undefined || this.pauseRequested)
            return;
        const generation = this.frameObservationGeneration;
        const frame = (_now, metadata) => {
            if (!this.isCurrent(sessionId) || generation !== this.frameObservationGeneration)
                return;
            this.presentedFrame = { position: metadata.mediaTime, count: metadata.presentedFrames };
            this.clearFirstFrameWatchdog();
            this.frameCallback = this.media.requestVideoFrameCallback(frame);
        };
        this.frameCallback = this.media.requestVideoFrameCallback(frame);
    }
    stopMediaObservation() {
        this.frameObservationGeneration++;
        if (this.frameCallback !== undefined)
            this.media.cancelVideoFrameCallback?.(this.frameCallback);
        this.frameCallback = undefined;
        clearInterval(this.mediaPoll);
        this.mediaPoll = undefined;
    }
    resetProgressObservation() {
        this.frameProgressStart = undefined;
        this.lastMediaPosition = undefined;
        this.frameObservation = undefined;
        this.videoFrameProgress = 'unavailable';
    }
    observeMediaProgress() {
        const position = this.media.currentTime;
        if (this.pauseRequested || this.media.paused || this.media.seeking || this.media.error || !Number.isFinite(position)) {
            this.resetProgressObservation();
            return false;
        }
        const advancing = this.lastMediaPosition !== undefined && position > this.lastMediaPosition;
        this.lastMediaPosition = position;
        if (this.options.unreliableFrameReporting && !this.frameProgressVerified) {
            const at = performance.now(), start = this.frameProgressStart;
            const elapsed = start ? (at - start.at) / 1000 : 0;
            const delta = start ? position - start.position : 0;
            // A clock jump alone is not playback. Require elapsed wall time and a
            // plausible forward clock; explicit seeks reset this window separately.
            if (!start || delta < 0 || delta > Math.max(2, elapsed * 4))
                this.frameProgressStart = { position, at };
            else if (elapsed >= 0.5 && delta >= 0.5)
                this.frameProgressVerified = true;
        }
        return advancing;
    }
    frameDiagnostics() {
        const quality = this.media.getVideoPlaybackQuality?.();
        const decodedFrames = this.media.webkitDecodedFrameCount ?? this.media.mozDecodedFrames;
        const count = this.presentedFrame?.count ?? (decodedFrames && decodedFrames > 0 ? decodedFrames : undefined) ?? (quality ? quality.totalVideoFrames - (quality.droppedVideoFrames ?? 0) : undefined);
        const position = this.media.currentTime, at = performance.now();
        if (count !== undefined && count > 0 && !this.media.paused && !this.pauseRequested && !this.media.seeking) {
            const previous = this.frameObservation;
            if (!previous || count < previous.count || position < previous.position) {
                this.frameObservation = { count, at, position };
                this.videoFrameProgress = 'observing';
            }
            else if (count > previous.count) {
                this.frameObservation = { count, at, position };
                this.videoFrameProgress = 'advancing';
            }
            else if (at - previous.at >= 2000 && position - previous.position >= 1) {
                this.videoFrameProgress = 'stalled';
            }
        }
        return {
            decodedFrames,
            videoFrames: quality?.totalVideoFrames,
            droppedFrames: quality?.droppedVideoFrames,
            presentedFrames: this.presentedFrame?.count,
            presentedPositionSeconds: this.presentedFrame ? this.timelineOffsetSeconds + this.presentedFrame.position : undefined,
            mediaPositionSeconds: this.timelineOffsetSeconds + position,
            videoFrameProgress: this.videoFrameProgress,
            videoFrameAgeMs: this.frameObservation ? Math.max(0, at - this.frameObservation.at) : undefined,
        };
    }
    hasVideoFrame() {
        const quality = this.media.getVideoPlaybackQuality?.();
        const frames = quality ? Math.max(0, quality.totalVideoFrames - (quality.droppedVideoFrames ?? 0)) : undefined;
        return this.presentedFrame !== undefined || ((this.media.videoWidth ?? 0) > 0 && (frames === undefined || frames > 0)) ||
            (this.options.unreliableFrameReporting === true && this.frameProgressVerified);
    }
    watchFirstFrame(sessionId) {
        if (!this.expectedVideo || this.pauseRequested || this.media.videoWidth === undefined || this.hasVideoFrame() || this.firstFrameTimer)
            return;
        this.firstFrameTimer = setTimeout(() => {
            this.clearFirstFrameWatchdog();
            if (!this.isCurrent(sessionId) || this.pauseRequested || this.hasVideoFrame() || this.snapshot.state === 'error')
                return;
            if ((this.startupDeadline === undefined || performance.now() < this.startupDeadline) && this.nativeHlsFallback?.(true))
                return;
            this.nativeHlsFallback = null;
            this.fail(sessionId, { code: 'unsupported-format', message: 'The selected source did not produce a decoded video frame.' });
            this.stopMediaObservation();
            this.media.pause();
            this.destroyHls();
        }, this.startupDeadline === undefined ? 8000 : Math.max(1, this.startupDeadline - performance.now()));
    }
    /** The seek bar's length: the server total, raised only by an original file. */
    titleDuration() {
        const next = timelineDuration(this.timelineDurationSeconds, knownDuration(this.media.duration), this.adoptEngineDuration);
        return (this.observedTitleDuration = growOnlyDuration(this.observedTitleDuration, next));
    }
    onMetadata() {
        if (this.hasVideoFrame())
            this.clearFirstFrameWatchdog();
        const sessionId = this.snapshot.sessionId;
        if (!this.isCurrent(sessionId))
            return;
        this.applySubtitleIntent();
        this.update(sessionId, { diagnostics: this.snapshot.diagnostics ? { ...this.snapshot.diagnostics, width: this.media.videoWidth, height: this.media.videoHeight, ...this.frameDiagnostics() } : undefined, time: { positionSeconds: this.timelineOffsetSeconds + this.media.currentTime, durationSeconds: this.titleDuration() }, tracks: this.tracks() });
    }
    onCanPlay() { this.onMetadata(); }
    applySubtitleIntent() {
        const request = this.subtitleRequest;
        if (!request)
            return;
        const tracks = this.tracks().text;
        if (!tracks.length)
            return; // Native renditions can arrive after metadata.
        const id = subtitleIntent(request, tracks);
        if (id === undefined)
            return;
        clearTimeout(this.subtitleTimer);
        this.subtitleRequest = undefined;
        // Selection is synchronous here; avoid an unobserved rejected promise.
        if (this.hls) {
            this.hls.subtitleTrack = id === null ? -1 : Number(id.slice('hls-text:'.length));
            this.hls.subtitleDisplay = id !== null;
        }
        else {
            for (const entry of selectableTextTracks(this.media))
                entry.track.mode = entry.id === id ? 'showing' : 'disabled';
        }
        this.update(this.snapshot.sessionId, { tracks: this.tracks() });
    }
    onPlay() {
        if (this.media.error || this.snapshot.state === 'error')
            return;
        const sessionId = this.snapshot.sessionId;
        if (this.pauseRequested) {
            this.media.pause();
            this.update(sessionId, { state: 'paused' });
            return;
        }
        this.startMediaObservation(sessionId);
        this.update(sessionId, { state: 'playing', error: null });
    }
    onPause() {
        this.stopMediaObservation();
        this.resetProgressObservation();
        if (this.pauseRequested)
            this.clearFirstFrameWatchdog();
        const sessionId = this.snapshot.sessionId;
        if (!this.media.ended && !this.media.error && this.snapshot.state !== 'error')
            this.update(sessionId, { state: 'paused' });
    }
    onWaiting() {
        if (this.pauseRequested)
            return;
        if (this.media.error || this.snapshot.state === 'error')
            return;
        const sessionId = this.snapshot.sessionId;
        this.update(sessionId, { state: 'buffering' });
    }
    onTimeUpdate() {
        if (this.media.error || this.snapshot.state === 'error' || !this.activeKind)
            return;
        const advancing = this.observeMediaProgress();
        if (this.hasVideoFrame())
            this.clearFirstFrameWatchdog();
        const sessionId = this.snapshot.sessionId;
        this.update(sessionId, { ...(advancing && !this.pauseRequested && !this.media.paused && !this.media.seeking &&
                this.hasVideoFrame() && ['ready', 'buffering'].includes(this.snapshot.state) ? { state: 'playing' } : {}),
            diagnostics: this.snapshot.diagnostics ? { ...this.snapshot.diagnostics, width: this.media.videoWidth, height: this.media.videoHeight, ...this.frameDiagnostics(), presentationEvidence: this.frameProgressVerified ? 'media-progress' : undefined } : undefined, time: this.publishableTime() });
    }
    /**
     * `progress` fires while data downloads even when `timeupdate` is silent
     * (mid-stall buffering, paused prefetch). Publishing here keeps the UI's
     * buffered ranges advancing during exactly the states where the viewer
     * watches the bar; ranges stay engine-reported, never invented.
     */
    onProgress() {
        if (this.media.error || this.snapshot.state === 'error')
            return;
        this.update(this.snapshot.sessionId, { time: this.publishableTime() });
    }
    publishableTime() {
        const time = { positionSeconds: this.timelineOffsetSeconds + this.media.currentTime, durationSeconds: this.titleDuration() };
        const ranges = this.engineBufferedRanges();
        if (!ranges)
            return time;
        return { ...time, bufferedRanges: ranges, bufferedEndSeconds: ranges[ranges.length - 1]?.end ?? null };
    }
    engineBufferedRanges() {
        const buffered = this.media.buffered;
        if (!buffered || !buffered.length)
            return null;
        const ranges = [];
        for (let index = 0; index < buffered.length; index += 1) {
            const start = this.timelineOffsetSeconds + buffered.start(index);
            const end = this.timelineOffsetSeconds + buffered.end(index);
            if (end > start)
                ranges.push({ start, end });
        }
        return ranges.length ? ranges : null;
    }
    onEnded() {
        this.stopMediaObservation();
        if (this.media.error || this.snapshot.state === 'error')
            return;
        const sessionId = this.snapshot.sessionId;
        this.update(sessionId, { state: 'ended' });
    }
    onError() {
        if (this.nativeHlsFallback?.())
            return;
        if (!this.media.error)
            return;
        this.stopMediaObservation();
        const sessionId = this.snapshot.sessionId;
        this.fail(sessionId, mediaError(this.media, 'connection-failed').toFailure());
    }
    destroyHls() {
        this.hls?.destroy();
        this.hls = null;
    }
    cancelPendingOpen() {
        if (this.pendingOpen) {
            this.pendingOpen.cancel();
            this.pendingOpen = null;
        }
    }
}
function listTextTracks(media) {
    if (!media.textTracks)
        return [];
    return Array.from({ length: media.textTracks.length }, (_, index) => media.textTracks[index]);
}
/** Preserve native indices: filtered-array indices cannot select the right cue. */
function selectableTextTracks(media) {
    return listTextTracks(media).flatMap((track, index) => (track.kind === 'captions' || track.kind === 'subtitles'
        ? [{ id: `text:${index}`, track }]
        : []));
}
function tracksFromMedia(media) {
    const tracks = selectableTextTracks(media);
    const text = tracks
        .map(({ id, track }, index) => ({
        id,
        label: track.label || `Subtitle ${index + 1}`,
        language: track.language || undefined,
        available: true,
    }));
    const selectedTextId = tracks.find((entry) => entry.track.mode === 'showing')?.id ?? null;
    const audio = Array.from(media.audioTracks ?? []).map((track, index) => ({ id: `audio:${index}`, label: track.label || track.language || `Audio ${index + 1}`, language: track.language, available: true }));
    const selectedAudio = Array.from(media.audioTracks ?? []).findIndex(track => track.enabled);
    return { audio, text, selectedAudioId: selectedAudio >= 0 ? `audio:${selectedAudio}` : null, selectedTextId };
}
function knownDuration(duration) {
    return Number.isFinite(duration) && duration > 0 ? duration : null;
}
function mediaError(media, code) {
    const message = media.error?.message ?? `HTML media error ${media.error?.code ?? 'unknown'}.`;
    return new PlayerOperationError(media.error?.code === 3 || media.error?.code === 4 ? 'unsupported-format' : code, message, media.error);
}

const clock = (s) => (s.startsWith('-') ? -1 : 1) * s.replace(/^-/, '').split(':').reduce((total, part) => total * 60 + Number(part), 0);
const cueText = (value) => value.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }[entity]));
/** Plain cue text is rendered as text, never inserted as HTML. */
function parseWebVtt(text, offset = 0) {
    const cues = [];
    const map = text.match(/X-TIMESTAMP-MAP=LOCAL:([^,\r\n]+),MPEGTS:(\d+)/);
    if (map)
        offset += Number(map[2]) / 90000 - clock(map[1]);
    for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
        const lines = block.split('\n');
        const index = lines.findIndex(line => line.includes(' --> '));
        if (index < 0)
            continue;
        const times = lines[index].match(/(-?[\d:.]+)\s+-->\s+(-?[\d:.]+)/);
        if (!times)
            continue;
        const start = clock(times[1]) + offset, end = clock(times[2]) + offset;
        if (Number.isFinite(start) && Number.isFinite(end) && end > start)
            cues.push({ start, end, text: cueText(lines.slice(index + 1).join('\n').replace(/\n+$/, '')).slice(0, 4096) });
        if (cues.length >= 4096)
            break;
    }
    return cues;
}
/** Caption extraction is requested only when the viewer opens the subtitle list. */
class BrowserCaptions {
    constructor(url, changed) {
        this.changed = changed;
        this.tracks = [];
        this.selected = null;
        this.cues = [];
        this.block = -1;
        this.generation = 0;
        this.loading = false;
        this.abort = new AbortController();
        this.base = new URL('.', url);
        this.fetch = sessionMediaFetch(url);
    }
    async discover() {
        if (this.tracks.length)
            return;
        const token = this.generation;
        const response = await this.fetch(new URL('tracks.json', this.base), { signal: this.abort.signal });
        const result = await response.json();
        if (token !== this.generation || this.abort.signal.aborted)
            return;
        this.tracks = (result.subtitles ?? []).slice(0, 32).map(t => ({ id: `subtitle:${t.input_index}`, label: t.title || t.language || `Subtitle ${t.input_index + 1}`, language: t.language, available: t.supported }));
        this.changed(this.tracks, this.selected, []);
    }
    async select(id, position) {
        if (id && !this.tracks.some(t => t.id === id && t.available))
            throw new Error('Subtitle is unavailable.');
        this.generation++;
        this.selected = id;
        this.cues = [];
        this.block = -1;
        this.changed(this.tracks, id, []);
        if (id)
            await this.load(position);
    }
    tick(position) {
        if (!this.selected)
            return;
        if (Math.floor(position / 60) !== this.block && !this.loading)
            void this.load(position).catch(() => { this.changed(this.tracks, this.selected, []); });
        this.changed(this.tracks, this.selected, this.cues.filter(c => c.start <= position && position < c.end).map(c => c.text));
    }
    async load(position) {
        if (!this.selected)
            return;
        const token = this.generation, id = this.selected.split(':')[1];
        this.loading = true;
        this.block = Math.floor(position / 60);
        try {
            const response = await this.fetch(new URL(`subtitle-${id}.vtt`, this.base), { headers: { 'x-viptv-subtitle-position': String(Math.max(0, position)) }, signal: this.abort.signal });
            const text = await response.text();
            if (token !== this.generation || text.length > 2 * 1024 * 1024)
                return;
            this.cues = parseWebVtt(text, Number(response.headers.get('X-VIPTV-Subtitle-Offset') ?? 0));
            this.block = Math.floor(position / 60);
        }
        finally {
            this.loading = false;
        }
    }
    dispose() { this.generation++; this.abort.abort(); this.cues = []; }
}

const trackId = (type, id) => `${type}:${id}`;
async function audioChoices(video) {
    const tracks = await video.getPairableAudioTracks();
    const choices = await Promise.all(tracks.map(async (track) => ({
        id: trackId('audio', track.id), label: await track.getName() || await track.getLanguageCode() || `Audio ${track.number}`,
        language: await track.getLanguageCode(), available: true,
        codec: await track.getCodec() ?? undefined,
    })));
    return { tracks, choices };
}
async function chooseAudio(video, request) {
    const tracks = await video.getPairableAudioTracks();
    if (request.audioTrackId) {
        const track = tracks.find(t => trackId('audio', t.id) === request.audioTrackId);
        if (track)
            return track;
    }
    if (request.preferredAudioLanguage) {
        for (const track of tracks)
            if (mediaLanguage(await track.getLanguageCode()) === mediaLanguage(request.preferredAudioLanguage))
                return track;
    }
    return video.getPrimaryPairableAudioTrack();
}
async function videoChoices(input) {
    const tracks = await input.getVideoTracks({ filter: async (track) => !(await track.hasOnlyKeyPackets()) });
    const choices = await Promise.all(tracks.map(async (track) => {
        const height = await track.getDisplayHeight();
        return { id: trackId('video', track.id), label: `${height}p`, width: await track.getDisplayWidth(), height,
            bitrate: await track.getAverageBitrate() || await track.getBitrate() || 0 };
    }));
    return { tracks, choices };
}
/** Conservative EWMA: cached/tiny transfers do not inflate the sustainable rate. */
class AdaptiveQuality {
    constructor() {
        this.slow = 0;
        this.fast = 0;
        this.upgradeSince = 0;
    }
    sample(bytes, seconds) {
        if (bytes < 65536 || seconds < 0.03)
            return;
        const rate = bytes * 8 / seconds;
        const ewma = (old, halfLife) => old ? old + (1 - Math.pow(0.5, seconds / halfLife)) * (rate - old) : rate;
        this.fast = ewma(this.fast, 3);
        this.slow = ewma(this.slow, 10);
    }
    choose(qualities, current, bufferedSeconds, now) {
        const sorted = [...qualities].sort((a, b) => a.bitrate - b.bitrate || a.height - b.height);
        const at = sorted.findIndex(q => q.id === current);
        if (at < 0 || !sorted.length)
            return current;
        const budget = Math.min(this.slow, this.fast) * 0.8;
        const eligible = sorted.filter(q => q.bitrate > 0 && q.bitrate <= budget);
        const best = budget ? eligible[eligible.length - 1] ?? sorted[0] : sorted[at];
        if (bufferedSeconds < 0.03 && at > 0) {
            this.upgradeSince = 0;
            return sorted[at - 1].id;
        }
        if (sorted.indexOf(best) < at) {
            this.upgradeSince = 0;
            return best.id;
        }
        if (sorted.indexOf(best) > at && bufferedSeconds >= 0.025) {
            this.upgradeSince ||= now;
            if (now - this.upgradeSince >= 10000) {
                this.upgradeSince = 0;
                return sorted[at + 1].id;
            }
        }
        else
            this.upgradeSince = 0;
        return current;
    }
}

/** WebCodecs availability is a gate, never proof that the selected track decodes. */
function mediabunnyUnavailable(canvas) {
    if (!canvas)
        return 'A MediaBunny drawing surface is unavailable.';
    if (!globalThis.isSecureContext)
        return 'WebCodecs requires HTTPS or a trusted local context.';
    if (typeof BigInt === 'undefined' || typeof VideoDecoder === 'undefined' || typeof AudioContext === 'undefined')
        return 'This runtime does not expose the required WebCodecs and Web Audio APIs.';
    return undefined;
}
/** Prefer real decoded samples; failure retains the exact delivery URL and backend lease. */
class Html5FallbackAdapter {
    get capabilities() {
        return { ...(this.active?.capabilities ?? VIZIO_HTML5_CAPABILITIES), platform: this.platform, canSetVolume: true,
            ...(this.inspectedAudio.length ? { canSelectAudioTrack: true } : {}), ...(this.captions ? { canSelectTextTrack: true, canDisableTextTrack: true } : {}) };
    }
    constructor(media, canvas, platform = 'html5') {
        this.media = media;
        this.canvas = canvas;
        this.platform = platform;
        this.listeners = new Set();
        this.value = IDLE_SNAPSHOT;
        this.generation = 0;
        this.opening = false;
        this.recovering = false;
        this.volume = 1;
        this.muted = false;
        this.pausedIntent = false;
        this.paths = [];
        this.captionTracks = [];
        this.captionId = null;
        this.captionText = [];
        this.inspectedAudio = [];
    }
    get snapshot() { return this.value; }
    subscribe(listener) { this.listeners.add(listener); listener(this.value); return () => this.listeners.delete(listener); }
    async open(request) {
        const generation = ++this.generation;
        this.startupDeadline = request.startupBudgetMs === undefined ? undefined : performance.now() + Math.max(0, Math.min(120_000, request.startupBudgetMs));
        this.cancelOpening?.();
        this.cancelOpening = undefined;
        this.clearSubscription();
        this.unsubscribe = undefined;
        const previous = this.active;
        this.active = undefined;
        await previous?.dispose();
        if (generation !== this.generation)
            return;
        this.pausedIntent = request.paused ?? false;
        this.audioInspector?.dispose();
        this.audioInspector = undefined;
        this.inspectedAudio = [];
        this.captions?.dispose();
        this.captions = undefined;
        this.captionTracks = [];
        this.captionText = [];
        this.captionId = null;
        if (browserPlaybackPolicy().clientInspection && request.deliveryMode === 'direct')
            this.captions = new BrowserCaptions(request.url, (tracks, selected, captions) => {
                if (generation !== this.generation)
                    return;
                this.captionTracks = tracks;
                this.captionId = selected;
                this.captionText = captions;
            });
        this.request = request;
        this.opening = true;
        this.recovering = false;
        this.fallbackReason = undefined;
        this.publish({ ...IDLE_SNAPSHOT, sessionId: generation, kind: request.kind, state: 'opening' });
        const unavailable = mediabunnyUnavailable(this.canvas);
        this.paths = unavailable ? ['native'] : ['bunny', 'native'];
        // Managed continuous MP4 has one bounded response body; a second local
        // consumer cannot reopen it. A native refusal needs a replacement session.
        if (request.deliveryFormat === 'fmp4')
            this.paths = ['native'];
        if (request.deliveryFormat !== 'fmp4' && browserPlaybackPolicy().localRemux && typeof BigInt !== 'undefined' && typeof MediaSource !== 'undefined' && this.media instanceof HTMLVideoElement)
            this.paths.push('mse');
        this.fallbackReason = unavailable;
        try {
            const preparePaused = request.paused || !!request.preferredSubtitleLanguage;
            await this.nextPath({ ...request, paused: preparePaused }, generation);
            if (generation !== this.generation)
                return;
            const playingAudio = this.value.tracks.audio.find(track => track.id === this.value.tracks.selectedAudioId);
            if (request.preferredAudioLanguage && (!playingAudio?.language || mediaLanguage(playingAudio.language) !== mediaLanguage(request.preferredAudioLanguage))) {
                await this.loadAudioTracks(false);
                if (generation !== this.generation)
                    return;
                let selected = this.value.tracks.audio.find(track => track.language && mediaLanguage(track.language) === mediaLanguage(request.preferredAudioLanguage));
                if (selected && !selected.available) {
                    await this.serverAudioChoices();
                    selected = this.value.tracks.audio.find(track => track.language && mediaLanguage(track.language) === mediaLanguage(request.preferredAudioLanguage));
                }
                if (selected?.delivery === 'server' && selected.inputIndex !== undefined)
                    throw new PlayerOperationError('unsupported-format', 'Preferred audio requires compatible delivery.', undefined, 'audio-codec', { audioTrackIndex: selected.inputIndex });
                if (selected?.available && this.value.tracks.selectedAudioId !== selected.id)
                    await this.selectAudioTrack(selected.id);
            }
            if (request.preferredSubtitleLanguage) {
                try {
                    await this.loadTextTracks();
                    if (generation !== this.generation)
                        return;
                    const selected = this.value.tracks.text.find(track => track.available && track.language && mediaLanguage(track.language) === mediaLanguage(request.preferredSubtitleLanguage));
                    if (selected)
                        await this.selectTextTrack(selected.id);
                    else
                        this.publish({ ...this.value, notice: 'Preferred subtitles are unavailable.' });
                }
                catch {
                    if (generation === this.generation)
                        this.publish({ ...this.value, notice: 'Subtitles could not be loaded.' });
                }
                if (!request.paused && generation === this.generation) {
                    try {
                        await this.requireActive().play();
                    }
                    catch (cause) {
                        const error = mediaFailure(cause);
                        if (error.code !== 'autoplay-blocked')
                            throw error;
                        this.publish({ ...this.value, state: 'paused', notice: 'Select Play to enable browser audio.' });
                    }
                }
            }
        }
        finally {
            if (generation === this.generation) {
                this.opening = false;
                this.cancelOpening = undefined;
            }
        }
    }
    async nextPath(request, generation) {
        while (this.paths.length && generation === this.generation) {
            const path = this.paths.shift();
            let player;
            if (path === 'bunny') {
                const { MediabunnyAdapter } = await import('./mediabunny-DAw0uoDL.js');
                if (generation !== this.generation)
                    return;
                player = new MediabunnyAdapter(this.canvas);
            }
            else if (path === 'mse') {
                const { MediabunnyMseAdapter } = await import('./mediabunny-mse-DG2C7RF-.js');
                if (generation !== this.generation)
                    return;
                player = new MediabunnyMseAdapter(this.media);
            }
            else
                player = new VizioHtml5Adapter(this.media);
            this.attach(player, generation, path === 'bunny');
            try {
                const remaining = this.startupDeadline === undefined ? undefined : this.startupDeadline - performance.now();
                if (remaining !== undefined && remaining <= 0)
                    throw new PlayerOperationError('connection-failed', 'Playback startup timed out.', undefined, 'network');
                await withTimeout(Promise.race([player.open({ ...request, startupBudgetMs: remaining }), new Promise(resolve => { this.cancelOpening = resolve; })]), remaining === undefined ? 15000 : Math.max(1, Math.min(15000, remaining)));
                return;
            }
            catch (cause) {
                if (generation !== this.generation)
                    return;
                const error = mediaFailure(cause);
                this.clearSubscription();
                await player.dispose();
                if (!canChangeMediaPath(error) || !this.paths.length)
                    throw error;
                this.fallbackReason = `${path} could not present these tracks; trying the next local playback path.`;
            }
        }
    }
    attach(player, generation, bunny) {
        this.clearSubscription();
        this.active = player;
        this.showCanvas(bunny);
        void player.setVolume?.(this.volume);
        void player.setMuted?.(this.muted);
        this.unsubscribe = player.subscribe(snapshot => {
            if (generation !== this.generation || this.active !== player)
                return;
            if (snapshot.state === 'error' && snapshot.error && canChangeMediaPath(snapshot.error) && this.paths.length && !this.opening && !this.recovering) {
                void this.recover(generation, snapshot);
                return;
            }
            if (snapshot.state === 'idle')
                return;
            this.captions?.tick(snapshot.time.positionSeconds);
            this.publish({ ...snapshot, sessionId: generation, tracks: { ...snapshot.tracks,
                    ...(this.inspectedAudio.length ? { audio: this.inspectedAudio } : {}), ...(this.captionTracks.length ? { text: this.captionTracks, selectedTextId: this.captionId } : {}) },
                captions: this.captionTracks.length ? this.captionText : snapshot.captions,
                notice: this.value.notice, diagnostics: snapshot.diagnostics ? { ...snapshot.diagnostics, ...(this.fallbackReason ? { fallbackReason: this.fallbackReason } : {}) } : undefined });
        });
    }
    async recover(generation, snapshot) {
        if (!this.request || generation !== this.generation)
            return;
        this.recovering = true;
        const request = { ...this.request, audioTrackId: snapshot.tracks.selectedAudioId ?? undefined, textTrackId: snapshot.tracks.selectedTextId, qualityId: snapshot.selectedQualityId, startAtSeconds: Math.max(0, snapshot.time.positionSeconds - (this.request.timelineOffsetSeconds ?? 0)), paused: this.pausedIntent };
        this.fallbackReason = 'Mediabunny decoding stopped; continuing the same session with HTML playback.';
        this.publish({ ...snapshot, sessionId: generation, state: 'buffering', error: null });
        this.clearSubscription();
        await this.active?.dispose();
        try {
            await this.nextPath(request, generation);
        }
        catch (error) {
            if (generation === this.generation)
                this.publish({ ...this.value, state: 'error', error: error instanceof PlayerOperationError ? error.toFailure() : { code: 'prepare-failed', message: 'The selected source could not be played.' } });
        }
        finally {
            if (generation === this.generation)
                this.recovering = false;
        }
    }
    async play() { this.pausedIntent = false; await this.requireActive().play(); }
    async pause() { this.pausedIntent = true; await this.requireActive().pause(); }
    async seek(position) { await this.requireActive().seek(position); }
    async setVolume(level) { this.volume = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 1)); if (this.volume > 0)
        this.muted = false; await this.active?.setVolume?.(this.volume); }
    async setMuted(muted) { this.muted = muted; await this.active?.setMuted?.(muted); }
    async loadAudioTracks(resolveServer = true) {
        if (!this.request || this.request.deliveryMode !== 'direct' || !browserPlaybackPolicy().localRemux)
            return;
        if (this.active?.capabilities.canSelectAudioTrack) {
            await this.active.loadAudioTracks?.();
            this.inspectedAudio = this.active.snapshot.tracks.audio;
            if (resolveServer)
                await this.serverAudioChoices();
            return;
        }
        if (this.inspectedAudio.length)
            return;
        if (typeof BigInt === 'undefined') {
            if (resolveServer)
                await this.serverAudioChoices(true);
            return;
        }
        const generation = this.generation;
        const { Input, UrlSource, ALL_FORMATS } = await import('mediabunny');
        if (generation !== this.generation)
            return;
        const input = this.audioInspector = new Input({ source: new UrlSource(this.request.url, { fetchFn: sessionMediaFetch(this.request.url), getRetryDelay: sessionMediaRetryDelay(true), maxCacheSize: 32 * 1024 * 1024 }), formats: ALL_FORMATS });
        try {
            const video = await input.getPrimaryVideoTrack();
            if (!video)
                return;
            const { tracks, choices } = await audioChoices(video);
            const available = await Promise.all(tracks.map(async (track) => typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(`audio/mp4; codecs="${await track.getCodecParameterString()}"`)));
            if (generation !== this.generation)
                return;
            this.inspectedAudio = choices.map((choice, index) => ({ ...choice, available: available[index] }));
            if (resolveServer)
                await this.serverAudioChoices();
            this.publish({ ...this.value, tracks: { ...this.value.tracks, audio: this.inspectedAudio } });
        }
        finally {
            input.dispose();
            if (this.audioInspector === input)
                this.audioInspector = undefined;
        }
    }
    async serverAudioChoices(all = false) {
        if (!this.request || !all && !this.inspectedAudio.some(track => !track.available))
            return;
        const generation = this.generation;
        const response = await sessionMediaFetch(this.request.url)(new URL('tracks.json', this.request.url));
        const result = await response.json();
        if (generation !== this.generation)
            return;
        const unavailable = this.inspectedAudio.filter(track => !track.available);
        const server = (result.audio ?? []).filter(track => track.selectable && Number.isInteger(track.input_index) && track.input_index >= 0 && track.input_index <= 65535
            && (all || unavailable.some(local => local.codec === track.codec && (!local.language || local.language === 'und' || local.language === track.language))))
            .map(track => ({ id: `server-audio:${track.input_index}`, label: track.title, language: track.language, codec: track.codec, available: true, delivery: 'server', inputIndex: track.input_index }));
        if (server.length)
            this.inspectedAudio = [...this.inspectedAudio.filter(track => track.available), ...server];
        this.publish({ ...this.value, tracks: { ...this.value.tracks, audio: this.inspectedAudio } });
    }
    async selectAudioTrack(id) {
        if (this.requireActive().capabilities.canSelectAudioTrack) {
            await this.requireActive().selectAudioTrack(id);
            return;
        }
        if (!this.inspectedAudio.some(track => track.id === id && track.available) || !this.request)
            throw new PlayerOperationError('unsupported-operation', 'This audio track cannot be selected locally.');
        const generation = this.generation;
        const previous = { ...this.request, startAtSeconds: this.value.time.positionSeconds - (this.request.timelineOffsetSeconds ?? 0), paused: this.value.state === 'paused' };
        this.opening = true;
        this.clearSubscription();
        await this.active?.dispose();
        this.inspectedAudio = [];
        try {
            this.paths = ['mse'];
            await this.nextPath({ ...previous, audioTrackId: id }, generation);
        }
        catch (cause) {
            if (generation === this.generation) {
                this.paths = ['native'];
                await this.nextPath(previous, generation);
            }
            throw cause;
        }
        finally {
            if (generation === this.generation)
                this.opening = false;
        }
    }
    async loadTextTracks() {
        if (this.active?.snapshot.tracks.text.length)
            return;
        await this.captions?.discover();
        if (this.captionTracks.length)
            this.publish({ ...this.value, tracks: { ...this.value.tracks, text: this.captionTracks, selectedTextId: this.captionId }, captions: this.captionText });
    }
    async selectTextTrack(id) {
        if (this.captions && (id?.startsWith('subtitle:') || id === null && this.captionTracks.length)) {
            await this.active?.selectTextTrack(null).catch(() => undefined);
            await this.captions.select(id, this.value.time.positionSeconds);
            this.publish({ ...this.value, tracks: { ...this.value.tracks, text: this.captionTracks, selectedTextId: id }, captions: [] });
        }
        else
            await this.requireActive().selectTextTrack(id);
    }
    async selectQuality(id) { await this.requireActive().selectQuality?.(id); }
    async preview(position) { return await this.requireActive().preview?.(position) ?? null; }
    async stop() {
        this.captions?.dispose();
        this.captions = undefined;
        this.audioInspector?.dispose();
        this.audioInspector = undefined;
        const generation = ++this.generation;
        this.cancelOpening?.();
        this.cancelOpening = undefined;
        this.clearSubscription();
        this.unsubscribe = undefined;
        const player = this.active;
        this.active = undefined;
        await player?.dispose();
        if (generation === this.generation) {
            this.showCanvas(false);
            this.publish({ ...IDLE_SNAPSHOT, sessionId: generation, state: 'stopped' });
        }
    }
    async dispose() { await this.stop(); this.publish({ ...this.value, state: 'disposed' }); }
    clearSubscription() { this.unsubscribe?.(); this.unsubscribe = undefined; }
    requireActive() { if (!this.active)
        throw new PlayerOperationError('invalid-state', 'No active playback session.'); return this.active; }
    showCanvas(show) {
        if (this.canvas)
            this.canvas.style.display = show ? '' : 'none';
        if ('style' in this.media)
            this.media.style.visibility = show ? 'hidden' : '';
    }
    publish(snapshot) { this.value = snapshot; for (const listener of this.listeners)
        listener(snapshot); }
}
async function withTimeout(operation, ms) {
    let timer;
    try {
        return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new PlayerOperationError('connection-failed', 'Media preparation timed out.', undefined, 'network')), ms); })]);
    }
    finally {
        clearTimeout(timer);
    }
}

const TIZEN_AVPLAY_CAPABILITIES = {
    platform: 'tizen',
    engine: 'Samsung AVPlay',
    directNative: 'probe-required',
    adaptiveStreaming: 'probe-required',
    drm: 'probe-required',
    canPause: true,
    canSeek: true,
    canSelectAudioTrack: true,
    canSelectTextTrack: true,
    canDisableTextTrack: true,
    canUseCookies: true,
    canUseUserAgent: true,
    limitations: [
        'Codec, DRM, adaptive and subtitle support vary by TV model and firmware; qualify the exact source on device.',
        'AVPlay TEXT selection is unavailable for DASH according to Samsung documentation.',
        'COOKIE and USER_AGENT are available only when this runtime exposes setStreamingProperty; arbitrary headers are unsupported.',
    ],
};
class TizenAvplayAdapter extends SessionPlayer {
    constructor(avplay = resolveAvplay()) {
        super();
        this.avplay = avplay;
        this.pendingOpen = null;
        this.pendingSeek = null;
        this.lifecycleGeneration = 0;
        this.timelineOffsetSeconds = 0;
        this.adoptEngineDuration = false;
        this.observedTitleDuration = null;
        this.pauseRequested = false;
        // Older/model-specific runtimes can expose AVPlay without the authorization
        // property API. Advertise only what this injected runtime can actually set.
        this.capabilities = {
            ...TIZEN_AVPLAY_CAPABILITIES,
            canUseCookies: Boolean(avplay.setStreamingProperty),
            canUseUserAgent: Boolean(avplay.setStreamingProperty),
        };
    }
    open(request) {
        this.lifecycleGeneration += 1;
        this.cancelPendingOpen();
        this.invalidateSession();
        const sessionId = this.startSession(request.kind);
        this.timelineOffsetSeconds = nonNegative(request.timelineOffsetSeconds ?? 0);
        this.timelineDurationSeconds = request.timelineDurationSeconds;
        this.adoptEngineDuration = request.adoptEngineDuration === true;
        this.observedTitleDuration = null;
        this.subtitleRequest = request;
        this.pauseRequested = request.paused === true;
        return new Promise((resolve, reject) => {
            this.pendingOpen = { sessionId, resolve, reject };
            void this.afterSeek(() => {
                this.closeSafely();
                try {
                    this.avplay.open(request.url);
                    this.avplay.setListener(this.listenerFor(sessionId));
                    this.setDisplayRect();
                    // COOKIE/USER_AGENT must be set in IDLE before prepareAsync().
                    this.applyAuthorization(request);
                    this.avplay.prepareAsync(() => this.prepared(sessionId, request), (cause) => this.preparationFailed(sessionId, cause));
                }
                catch (cause) {
                    this.preparationFailed(sessionId, cause);
                }
            }, () => this.isCurrent(sessionId)).catch(cause => this.preparationFailed(sessionId, cause));
        });
    }
    async play() {
        const sessionId = this.activeSessionOrThrow();
        this.pauseRequested = false;
        return this.afterSeek(() => {
            if (this.snapshot.state === 'playing')
                return;
            try {
                this.avplay.play();
                this.applySubtitleIntent(sessionId);
                this.update(sessionId, { state: 'playing', error: null });
            }
            catch (cause) {
                this.throwOperation(sessionId, 'invalid-state', 'AVPlay could not resume playback.', cause);
            }
        }, () => this.isCurrent(sessionId));
    }
    async pause() {
        const sessionId = this.activeSessionOrThrow();
        this.pauseRequested = true;
        return this.afterSeek(() => {
            // A prepared paused open is still READY natively; pause() is invalid there.
            if (this.snapshot.state === 'paused')
                return;
            try {
                this.avplay.pause();
                this.update(sessionId, { state: 'paused' });
            }
            catch (cause) {
                this.throwOperation(sessionId, 'invalid-state', 'AVPlay could not pause playback.', cause);
            }
        }, () => this.isCurrent(sessionId));
    }
    seek(positionSeconds) {
        const sessionId = this.activeSessionOrThrow();
        if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
            return Promise.reject(new PlayerOperationError('seek-failed', 'Seek position must be a non-negative number.'));
        }
        return this.afterSeek(() => new Promise((resolve, reject) => {
            const nativePosition = Math.max(0, positionSeconds - this.timelineOffsetSeconds);
            this.nativeSeek(Math.round(nativePosition * 1000), () => {
                if (this.isCurrent(sessionId))
                    this.updateTimeFromEngine(sessionId, positionSeconds);
                resolve();
            }, (cause) => {
                reject(operationFailure('seek-failed', 'AVPlay could not seek the selected source.', cause));
            });
        }), () => this.isCurrent(sessionId));
    }
    async stop() {
        const generation = ++this.lifecycleGeneration;
        this.subtitleRequest = undefined;
        this.cancelPendingOpen();
        this.invalidateSession();
        this.terminal('stopped');
        return this.afterSeek(() => {
            try {
                this.avplay.stop();
            }
            catch { /* stop is state-dependent on AVPlay */ }
            this.closeSafely();
        }, () => generation === this.lifecycleGeneration);
    }
    async dispose() {
        const generation = this.lifecycleGeneration + 1;
        await this.stop();
        if (generation === this.lifecycleGeneration)
            this.terminal('disposed');
    }
    async selectAudioTrack(trackId) {
        const sessionId = this.activeSessionOrThrow();
        const track = this.findTrack('audio', trackId);
        if (!track)
            throw new PlayerOperationError('unsupported-operation', `Audio track ${trackId} is not available.`);
        return this.afterSeek(() => {
            try {
                this.avplay.setSelectTrack('AUDIO', parseTrackIndex(trackId));
                this.update(sessionId, { tracks: { ...this.snapshot.tracks, selectedAudioId: trackId } });
            }
            catch (cause) {
                this.throwOperation(sessionId, 'unsupported-operation', `AVPlay could not select audio track ${track.label}.`, cause);
            }
        }, () => this.isCurrent(sessionId));
    }
    async selectTextTrack(trackId) {
        this.subtitleRequest = undefined;
        const sessionId = this.activeSessionOrThrow();
        return this.afterSeek(() => {
            try {
                if (trackId === null) {
                    // Samsung defines true as hidden and false as shown.
                    this.avplay.setSilentSubtitle(true);
                    this.update(sessionId, { tracks: { ...this.snapshot.tracks, selectedTextId: null } });
                    return;
                }
                const track = this.findTrack('text', trackId);
                if (!track)
                    throw new PlayerOperationError('unsupported-operation', `Subtitle track ${trackId} is not available.`);
                this.avplay.setSelectTrack('TEXT', parseTrackIndex(trackId));
                this.avplay.setSilentSubtitle(false);
                this.update(sessionId, { tracks: { ...this.snapshot.tracks, selectedTextId: trackId } });
            }
            catch (cause) {
                if (cause instanceof PlayerOperationError)
                    throw cause;
                this.throwOperation(sessionId, 'unsupported-operation', 'AVPlay could not select subtitles for this source.', cause);
            }
        }, () => this.isCurrent(sessionId));
    }
    prepared(sessionId, request) {
        if (!this.isCurrent(sessionId))
            return;
        const startAtSeconds = boundedPosition(request.startAtSeconds ?? 0, this.durationSeconds());
        this.update(sessionId, {
            state: 'ready',
            time: { positionSeconds: this.timelineOffsetSeconds + startAtSeconds, durationSeconds: this.durationSeconds() },
            tracks: tracksFromAvplay(this.avplay.getTotalTrackInfo()),
            error: null,
        });
        const complete = () => {
            if (!this.isCurrent(sessionId))
                return;
            if (this.pauseRequested) {
                this.update(sessionId, { state: 'paused' });
            }
            else {
                try {
                    this.avplay.play();
                    this.applySubtitleIntent(sessionId);
                    this.update(sessionId, { state: 'playing' });
                }
                catch (cause) {
                    this.preparationFailed(sessionId, cause);
                    return;
                }
            }
            this.resolvePending(sessionId);
        };
        if (startAtSeconds > 0) {
            this.nativeSeek(Math.round(startAtSeconds * 1000), complete, (cause) => this.preparationFailed(sessionId, cause));
        }
        else {
            complete();
        }
    }
    preparationFailed(sessionId, cause) {
        if (!this.isCurrent(sessionId))
            return;
        const error = cause instanceof PlayerOperationError
            ? cause
            : operationFailure('prepare-failed', 'AVPlay could not prepare the selected source.', cause);
        this.fail(sessionId, error.toFailure());
        if (this.pendingOpen?.sessionId === sessionId) {
            this.pendingOpen.reject(error);
            this.pendingOpen = null;
        }
    }
    listenerFor(sessionId) {
        return {
            onbufferingstart: () => {
                if (!this.isCurrent(sessionId) || this.snapshot.state === 'error' || this.pauseRequested)
                    return;
                this.bufferingPosition = undefined;
                this.update(sessionId, { state: 'buffering' });
            },
            onbufferingcomplete: () => {
                if (this.snapshot.state === 'buffering')
                    this.update(sessionId, { state: this.pauseRequested ? 'paused' : 'playing' });
            },
            // AVPlay's documented callback value is the event's timeline fact. Do not
            // replace it with a second engine read that can lag behind the callback.
            oncurrentplaytime: (milliseconds) => {
                if (!this.isCurrent(sessionId))
                    return;
                try {
                    if (!this.pendingSeek)
                        this.applySubtitleIntent(sessionId);
                }
                catch (cause) {
                    this.fail(sessionId, operationFailure('unsupported-operation', 'AVPlay could not select the requested subtitles.', cause).toFailure());
                    return;
                }
                const position = milliseconds / 1000;
                const recovered = this.snapshot.state === 'buffering' && !this.pauseRequested &&
                    this.bufferingPosition !== undefined && position > this.bufferingPosition;
                this.bufferingPosition = position;
                this.update(sessionId, {
                    ...(recovered ? { state: 'playing' } : {}),
                    time: { positionSeconds: this.timelineOffsetSeconds + position, durationSeconds: this.durationSeconds() },
                });
            },
            onstreamcompleted: () => this.update(sessionId, { state: 'ended' }),
            onerror: (code) => this.fail(sessionId, operationFailure('connection-failed', `AVPlay error: ${code}`).toFailure()),
            onerrormsg: (code, message) => this.fail(sessionId, operationFailure('connection-failed', `AVPlay error ${code}: ${message}`).toFailure()),
        };
    }
    updateTimeFromEngine(sessionId, fallbackPosition) {
        let nativePositionSeconds = Math.max(0, fallbackPosition - this.timelineOffsetSeconds);
        try {
            nativePositionSeconds = this.avplay.getCurrentTime() / 1000;
        }
        catch { /* requested native position remains useful */ }
        this.update(sessionId, { time: { positionSeconds: this.timelineOffsetSeconds + nativePositionSeconds, durationSeconds: this.durationSeconds() } });
    }
    durationSeconds() {
        if (this.pendingSeek)
            return this.observedTitleDuration;
        let engine = null;
        try {
            const duration = this.avplay.getDuration() / 1000;
            engine = Number.isFinite(duration) && duration > 0 ? duration + this.timelineOffsetSeconds : null;
        }
        catch {
            engine = null;
        }
        // A managed delivery is a rolling window; the server total is authoritative
        // and the reported length only ever grows.
        const next = timelineDuration(this.timelineDurationSeconds, engine, this.adoptEngineDuration);
        return (this.observedTitleDuration = growOnlyDuration(this.observedTitleDuration, next));
    }
    applyAuthorization(request) {
        const authorization = checkedSourceAuthorization(request.authorization);
        if (!authorization)
            return;
        if (Object.keys(authorization.headers ?? {}).length)
            throw new PlayerOperationError('authorization-unsupported', 'This source requires gateway delivery for its request headers.');
        if (!this.avplay.setStreamingProperty) {
            throw new PlayerOperationError('authorization-unsupported', 'This AVPlay runtime cannot set authorization properties.');
        }
        if (authorization.cookie)
            this.avplay.setStreamingProperty('COOKIE', authorization.cookie);
        if (authorization.userAgent)
            this.avplay.setStreamingProperty('USER_AGENT', authorization.userAgent);
    }
    findTrack(kind, id) {
        return this.snapshot.tracks[kind].find((track) => track.id === id && track.available);
    }
    applySubtitleIntent(sessionId) {
        const request = this.subtitleRequest;
        if (!request || !this.isCurrent(sessionId))
            return;
        const tracks = tracksFromAvplay(this.avplay.getTotalTrackInfo());
        const id = subtitleIntent(request, tracks.text);
        if (id === undefined)
            return;
        this.subtitleRequest = undefined;
        // HLS TEXT selection is allowed in PLAYING/PAUSED, not READY.
        if (id !== null)
            this.avplay.setSelectTrack('TEXT', parseTrackIndex(id));
        this.avplay.setSilentSubtitle(id === null);
        this.update(sessionId, { tracks: { ...tracks, selectedTextId: id } });
    }
    throwOperation(sessionId, code, message, cause) {
        const error = operationFailure(code, message, cause);
        this.fail(sessionId, error.toFailure());
        throw error;
    }
    resolvePending(sessionId) {
        if (this.pendingOpen?.sessionId === sessionId) {
            this.pendingOpen.resolve();
            this.pendingOpen = null;
        }
    }
    cancelPendingOpen() {
        if (this.pendingOpen) {
            this.pendingOpen.resolve();
            this.pendingOpen = null;
        }
    }
    afterSeek(action, wanted) {
        if (!wanted())
            return Promise.resolve();
        if (this.pendingSeek)
            return this.pendingSeek.then(() => this.afterSeek(action, wanted));
        try {
            return Promise.resolve(action());
        }
        catch (cause) {
            return Promise.reject(cause);
        }
    }
    nativeSeek(milliseconds, success, error) {
        let release;
        const pending = new Promise(resolve => { release = resolve; });
        this.pendingSeek = pending;
        let settled = false;
        const finish = (callback) => {
            if (settled)
                return;
            settled = true;
            // AVPlay forbids every other API until either seek callback arrives.
            this.pendingSeek = null;
            release();
            callback();
        };
        try {
            this.avplay.seekTo(milliseconds, () => finish(success), cause => finish(() => error(cause)));
        }
        catch (cause) {
            finish(() => error(cause));
        }
    }
    closeSafely() {
        try {
            this.avplay.close();
        }
        catch { /* closing NONE/IDLE is implementation-specific */ }
    }
    setDisplayRect() {
        if (!this.avplay.setDisplayRect)
            return;
        const width = typeof window === 'undefined' ? 1920 : Math.max(1, Math.floor(window.innerWidth));
        const height = typeof window === 'undefined' ? 1080 : Math.max(1, Math.floor(window.innerHeight));
        this.avplay.setDisplayRect(0, 0, width, height);
    }
}
function resolveAvplay() {
    const runtime = globalThis;
    if (!runtime.webapis?.avplay) {
        throw new PlayerOperationError('engine-unavailable', 'Samsung AVPlay is unavailable in this runtime.');
    }
    return runtime.webapis.avplay;
}
function tracksFromAvplay(infos) {
    const audio = [];
    const text = [];
    for (const info of infos) {
        if (info.type !== 'AUDIO' && info.type !== 'TEXT')
            continue;
        const kind = info.type === 'AUDIO' ? 'audio' : 'text';
        const metadata = parseExtraInfo(info.extra_info);
        const language = readString(metadata, 'language') ?? readString(metadata, 'track_lang') ?? readString(metadata, 'lang');
        const codec = readString(metadata, 'fourCC') ?? readString(metadata, 'codec');
        const label = [language, codec].filter(Boolean).join(' · ') || `${kind === 'audio' ? 'Audio' : 'Subtitle'} ${info.index}`;
        const track = { id: `${kind}:${info.index}`, label, language, available: true };
        (kind === 'audio' ? audio : text).push(track);
    }
    return { audio, text, selectedAudioId: null, selectedTextId: null };
}
function parseExtraInfo(value) {
    try {
        const parsed = JSON.parse(value);
        return parsed !== null && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return {};
    }
}
function readString(value, key) {
    const candidate = value[key];
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}
function parseTrackIndex(id) {
    const index = Number(id.slice(id.indexOf(':') + 1));
    if (!Number.isInteger(index) || index < 0)
        throw new PlayerOperationError('unsupported-operation', `Invalid track identifier ${id}.`);
    return index;
}
function operationFailure(code, message, cause) {
    return new PlayerOperationError(code, message, cause);
}

function visibleSurfaceBounds(layout, scale, viewport) {
    return {
        left: clamp(layout.x / scale, 0, viewport.width),
        top: clamp(layout.y / scale, 0, viewport.height),
        right: clamp((layout.x + layout.width) / scale, 0, viewport.width),
        bottom: clamp((layout.y + layout.height) / scale, 0, viewport.height),
    };
}
/** Canonical numeric clamp shared by the surface layout and geometry helpers. */
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

// Adapted from get-air/tauri-video-plugin at 6baf19ff (MIT OR Apache-2.0).
const ZERO_RADIUS = Object.freeze({ x: 0, y: 0 });
const ZERO_RADII = Object.freeze([
    ZERO_RADIUS, ZERO_RADIUS, ZERO_RADIUS, ZERO_RADIUS,
]);
const ZERO_RADIUS_STYLES = Object.freeze(['0px', '0px', '0px', '0px']);
function outsidePanels(ancestor, hole) {
    const right = ancestor.left + ancestor.width;
    const bottom = ancestor.top + ancestor.height;
    const intersectionLeft = clamp(hole.left, ancestor.left, right);
    const intersectionTop = clamp(hole.top, ancestor.top, bottom);
    const intersectionRight = clamp(hole.right, ancestor.left, right);
    const intersectionBottom = clamp(hole.bottom, ancestor.top, bottom);
    if (intersectionRight <= intersectionLeft || intersectionBottom <= intersectionTop) {
        return [{ left: 0, top: 0, width: ancestor.width, height: ancestor.height },
            EMPTY_PANEL, EMPTY_PANEL, EMPTY_PANEL];
    }
    const left = intersectionLeft - ancestor.left;
    const top = intersectionTop - ancestor.top;
    const localRight = intersectionRight - ancestor.left;
    const localBottom = intersectionBottom - ancestor.top;
    return [
        { left: 0, top: 0, width: ancestor.width, height: top },
        { left: 0, top: localBottom, width: ancestor.width, height: ancestor.height - localBottom },
        { left: 0, top, width: left, height: localBottom - top },
        { left: localRight, top, width: ancestor.width - localRight, height: localBottom - top },
    ];
}
function intersectBounds(first, second) {
    const left = Math.max(first.left, second.left);
    const top = Math.max(first.top, second.top);
    return {
        left,
        top,
        right: Math.max(left, Math.min(first.right, second.right)),
        bottom: Math.max(top, Math.min(first.bottom, second.bottom)),
    };
}
function subtractRadius(radius, horizontal, vertical) {
    return { x: Math.max(0, radius.x - horizontal), y: Math.max(0, radius.y - vertical) };
}
function parseCornerRadii(styles, bounds) {
    const width = Math.max(0, bounds.right - bounds.left);
    const height = Math.max(0, bounds.bottom - bounds.top);
    return styles.map((style) => {
        const [horizontal = '0', vertical = horizontal] = style.trim().split(/\s+/);
        return { x: radiusPixels(horizontal, width), y: radiusPixels(vertical, height) };
    });
}
function radiiForIntersection(bounds, shape, radii) {
    return [
        sameEdge(bounds.left, shape.left) && sameEdge(bounds.top, shape.top) ? radii[0] : ZERO_RADIUS,
        sameEdge(bounds.right, shape.right) && sameEdge(bounds.top, shape.top) ? radii[1] : ZERO_RADIUS,
        sameEdge(bounds.right, shape.right) && sameEdge(bounds.bottom, shape.bottom) ? radii[2] : ZERO_RADIUS,
        sameEdge(bounds.left, shape.left) && sameEdge(bounds.bottom, shape.bottom) ? radii[3] : ZERO_RADIUS,
    ];
}
function mergeIntersectionRadii(previousBounds, previousRadii, bounds, shape, shapeRadii) {
    const introduced = radiiForIntersection(bounds, shape, shapeRadii);
    return radiiForIntersection(bounds, previousBounds, previousRadii).map((radius, index) => ({
        x: Math.max(radius.x, introduced[index].x),
        y: Math.max(radius.y, introduced[index].y),
    }));
}
function cornerPanels(bounds, radii) {
    return [
        { left: bounds.left, top: bounds.top, width: radii[0].x, height: radii[0].y },
        { left: bounds.right - radii[1].x, top: bounds.top, width: radii[1].x, height: radii[1].y },
        { left: bounds.right - radii[2].x, top: bounds.bottom - radii[2].y,
            width: radii[2].x, height: radii[2].y },
        { left: bounds.left, top: bounds.bottom - radii[3].y, width: radii[3].x, height: radii[3].y },
    ];
}
function cornerClipPath(outer, center, startDegrees, endDegrees) {
    const points = [outer];
    for (let step = 0; step <= 8; step += 1) {
        const angle = (startDegrees + (endDegrees - startDegrees) * step / 8) * Math.PI / 180;
        points.push([center[0] + 100 * Math.cos(angle), center[1] + 100 * Math.sin(angle)]);
    }
    return `polygon(${points.map(([x, y]) => `${cleanPercent(x)}% ${cleanPercent(y)}%`).join(',')})`;
}
function radiusPixels(value, extent) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed))
        return 0;
    return Math.max(0, value.endsWith('%') ? extent * parsed / 100 : parsed);
}
function sameEdge(first, second) {
    return Math.abs(first - second) < 0.01;
}
function cleanPercent(value) {
    if (Math.abs(value) < 0.0001)
        return 0;
    if (Math.abs(value - 100) < 0.0001)
        return 100;
    return Math.round(value * 1_000) / 1_000;
}
const EMPTY_PANEL = Object.freeze({ left: 0, top: 0, width: 0, height: 0 });
const CORNER_CLIP_PATHS = Object.freeze([
    cornerClipPath([0, 0], [100, 100], -90, -180),
    cornerClipPath([100, 0], [0, 100], -90, 0),
    cornerClipPath([100, 100], [0, 0], 90, 0),
    cornerClipPath([0, 100], [100, 0], 90, 180),
]);

/** DOM overlays protected from the native video's aperture. */
const VIDEO_CONTROLS_ATTRIBUTE = 'data-viptv-video-controls';

const BACKGROUND_PROPERTIES = [
    'background-color', 'background-image', 'background-position', 'background-size',
    'background-repeat', 'background-origin', 'background-clip', 'background-attachment',
    'background-blend-mode', 'box-sizing', 'padding-top', 'padding-right', 'padding-bottom',
    'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width',
    'border-left-width', 'border-top-style', 'border-right-style', 'border-bottom-style',
    'border-left-style',
];
/**
 * Re-reads the real page styling with the aperture rule temporarily
 * disabled. All writes happen before all reads, and all mirror writes
 * happen after, so one refresh causes at most one style/layout calculation.
 */
function refreshBackgrounds(state) {
    for (const ancestor of state.drilled) {
        if (ancestor.element.getAttribute('data-tauri-native-video-hole') === state.owner) {
            ancestor.element.removeAttribute('data-tauri-native-video-hole');
        }
    }
    const backgrounds = state.drilled.map(({ element }) => readBackground(element));
    state.anchorRadii = readCornerRadiusStyles(state.anchor);
    for (const ancestor of state.drilled) {
        ancestor.element.setAttribute('data-tauri-native-video-hole', state.owner);
    }
    for (let index = 0; index < state.drilled.length; index += 1) {
        applyBackground(state.drilled[index], backgrounds[index]);
    }
}
function readBackground(element) {
    const computed = getComputedStyle(element);
    return {
        properties: BACKGROUND_PROPERTIES.map((property) => [property, computed.getPropertyValue(property)]),
        borderRadius: computed.borderRadius,
        clipsX: clipsOverflow(computed.overflowX),
        clipsY: clipsOverflow(computed.overflowY),
        borderLeft: cssPixels(computed.borderLeftWidth),
        borderTop: cssPixels(computed.borderTopWidth),
        borderRight: cssPixels(computed.borderRightWidth),
        borderBottom: cssPixels(computed.borderBottomWidth),
        radii: readCornerRadiusStyles(element, computed),
        paintsBackground: hasVisibleBackground(computed),
    };
}
function applyBackground(ancestor, snapshot) {
    ancestor.paintsBackground = snapshot.paintsBackground;
    if (snapshot.paintsBackground && ancestor.panels.length === 0)
        createBackgroundPanels(ancestor);
    setStyle(ancestor.mirror, 'display', snapshot.paintsBackground ? 'block' : 'none');
    for (const panel of ancestor.panels) {
        for (const [property, value] of snapshot.properties) {
            setStyle(panel.paint, property, value);
        }
        setStyle(panel.paint, 'border-color', 'transparent');
    }
    setStyle(ancestor.mirror, 'border-radius', snapshot.borderRadius);
    ancestor.clipsX = snapshot.clipsX;
    ancestor.clipsY = snapshot.clipsY;
    ancestor.borderLeft = snapshot.borderLeft;
    ancestor.borderTop = snapshot.borderTop;
    ancestor.borderRight = snapshot.borderRight;
    ancestor.borderBottom = snapshot.borderBottom;
    ancestor.radii = snapshot.radii;
}
function createBackgroundPanels(ancestor) {
    ancestor.panels = Array.from({ length: 8 }, (_, index) => {
        const clip = document.createElement('div');
        const paint = document.createElement('div');
        Object.assign(clip.style, { position: 'absolute', overflow: 'hidden' });
        Object.assign(paint.style, { position: 'absolute', top: '0', left: '0' });
        if (index >= 4)
            clip.style.clipPath = CORNER_CLIP_PATHS[index - 4];
        clip.append(paint);
        ancestor.mirror.append(clip);
        return { clip, paint };
    });
}
function commitAncestor(ancestor, rect, hole, radii) {
    if (!ancestor.paintsBackground)
        return;
    setStyle(ancestor.mirror, 'transform', `translate3d(${rect.left}px, ${rect.top}px, 0)`);
    setStyle(ancestor.mirror, 'width', `${Math.max(0, rect.width)}px`);
    setStyle(ancestor.mirror, 'height', `${Math.max(0, rect.height)}px`);
    const panels = outsidePanels(rect, hole);
    for (let index = 0; index < 4; index += 1) {
        const panel = ancestor.panels[index];
        const region = panels[index];
        setStyle(panel.clip, 'transform', `translate3d(${region.left}px, ${region.top}px, 0)`);
        setStyle(panel.clip, 'width', `${Math.max(0, region.width)}px`);
        setStyle(panel.clip, 'height', `${Math.max(0, region.height)}px`);
        setStyle(panel.paint, 'transform', `translate3d(${-region.left}px, ${-region.top}px, 0)`);
        setStyle(panel.paint, 'width', `${Math.max(0, rect.width)}px`);
        setStyle(panel.paint, 'height', `${Math.max(0, rect.height)}px`);
    }
    const corners = cornerPanels(hole, radii);
    for (let index = 0; index < 4; index += 1) {
        const panel = ancestor.panels[index + 4];
        const region = corners[index];
        const localLeft = region.left - rect.left;
        const localTop = region.top - rect.top;
        setStyle(panel.clip, 'transform', `translate3d(${localLeft}px, ${localTop}px, 0)`);
        setStyle(panel.clip, 'width', `${Math.max(0, region.width)}px`);
        setStyle(panel.clip, 'height', `${Math.max(0, region.height)}px`);
        setStyle(panel.paint, 'transform', `translate3d(${-localLeft}px, ${-localTop}px, 0)`);
        setStyle(panel.paint, 'width', `${Math.max(0, rect.width)}px`);
        setStyle(panel.paint, 'height', `${Math.max(0, rect.height)}px`);
    }
}
function commitOccluder(occluder, rect, hole) {
    const right = rect.left + rect.width;
    const bottom = rect.top + rect.height;
    const left = Math.max(rect.left, hole.left);
    const top = Math.max(rect.top, hole.top);
    const clippedRight = Math.min(right, hole.right);
    const clippedBottom = Math.min(bottom, hole.bottom);
    if (rect.width <= 0 || rect.height <= 0 || clippedRight <= left || clippedBottom <= top) {
        restoreOccluder(occluder);
        return;
    }
    let image = '';
    let position = '';
    let size = '';
    for (const panel of outsidePanels(rect, hole)) {
        if (panel.width <= 0 || panel.height <= 0)
            continue;
        const separator = image ? ',' : '';
        image += `${separator}linear-gradient(#000, #000)`;
        position += `${separator}${panel.left}px ${panel.top}px`;
        size += `${separator}${panel.width}px ${panel.height}px`;
    }
    if (!image) {
        image = 'linear-gradient(transparent, transparent)';
        position = '0 0';
        size = '100% 100%';
    }
    if (occluder.element.getAttribute(OCCLUDER_ATTRIBUTE) !== occluder.owner) {
        occluder.element.setAttribute(OCCLUDER_ATTRIBUTE, occluder.owner);
    }
    occluder.active = true;
    setProperty(occluder.element, MASK_IMAGE_PROPERTY, image, 'important');
    setProperty(occluder.element, MASK_POSITION_PROPERTY, position, 'important');
    setProperty(occluder.element, MASK_SIZE_PROPERTY, size, 'important');
}
function hasVisibleBackground(computed) {
    const image = computed.backgroundImage.trim();
    if (image && image !== 'none')
        return true;
    const color = computed.backgroundColor.trim().toLowerCase();
    if (!color || color === 'transparent')
        return false;
    if (/\/\s*0(?:\.0+)?\s*\)$/.test(color))
        return false;
    if (/rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(color))
        return false;
    return true;
}
function cssPixels(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function readCornerRadiusStyles(element, computed = getComputedStyle(element)) {
    return [
        computed.borderTopLeftRadius,
        computed.borderTopRightRadius,
        computed.borderBottomRightRadius,
        computed.borderBottomLeftRadius,
    ];
}
function setStyle(element, property, value) {
    let values = committedStyleValues.get(element);
    if (!values) {
        values = new Map();
        committedStyleValues.set(element, values);
    }
    if (values.get(property) === value)
        return;
    if (element.style.getPropertyValue(property) !== value)
        element.style.setProperty(property, value);
    values.set(property, value);
}
function setProperty(element, property, value, priority = '') {
    if (element.style.getPropertyValue(property) !== value
        || (priority && element.style.getPropertyPriority(property) !== priority)) {
        element.style.setProperty(property, value, priority);
    }
}
function inlineProperty(element, property) {
    return {
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property),
    };
}
function restoreInlineProperty(element, property, snapshot) {
    if (snapshot.value)
        element.style.setProperty(property, snapshot.value, snapshot.priority);
    else
        element.style.removeProperty(property);
}
function clipsOverflow(value) {
    return value === 'hidden' || value === 'clip' || value === 'scroll' || value === 'auto';
}

// Adapted from get-air/tauri-video-plugin at 6baf19ff (MIT OR Apache-2.0).
const nativeCssSurfaceScope = globalThis;
const committedStyleValues = new WeakMap();
const OCCLUDER_ATTRIBUTE = 'data-tauri-native-video-occluder';
const MASK_IMAGE_PROPERTY = '--tauri-native-video-mask-image';
const MASK_POSITION_PROPERTY = '--tauri-native-video-mask-position';
const MASK_SIZE_PROPERTY = '--tauri-native-video-mask-size';
const NATIVE_VIDEO_CSS_PROPERTIES = [
    '--tauri-native-video-left',
    '--tauri-native-video-top',
    '--tauri-native-video-right',
    '--tauri-native-video-bottom',
    '--tauri-native-video-width',
    '--tauri-native-video-height',
];
function claimSurface(owner, anchor) {
    const existing = nativeCssSurfaceScope.__TAURI_VIDEO_NATIVE_CSS_SURFACE__;
    if (existing?.anchor === anchor && existing.layer.isConnected) {
        for (const ancestor of existing.drilled) {
            if (ancestor.element.getAttribute('data-tauri-native-video-hole') === existing.owner) {
                ancestor.element.setAttribute('data-tauri-native-video-hole', owner);
            }
        }
        for (const occluder of existing.occluders) {
            if (occluder.element.getAttribute(OCCLUDER_ATTRIBUTE) === existing.owner) {
                occluder.element.setAttribute(OCCLUDER_ATTRIBUTE, owner);
            }
            occluder.owner = owner;
        }
        existing.owner = owner;
        existing.style.textContent = holeStyle(owner);
        document.documentElement.dataset.tauriNativeVideoSession = owner;
        return;
    }
    if (existing)
        releaseSurface(existing.owner);
    removeOrphanedSurfaceNodes();
    const root = document.documentElement;
    const layer = document.createElement('div');
    layer.dataset.tauriNativeVideoBackdrop = '';
    layer.setAttribute('aria-hidden', 'true');
    Object.assign(layer.style, {
        position: 'fixed',
        zIndex: '-2147483647',
        inset: '0',
        overflow: 'hidden',
        pointerEvents: 'none',
        contain: 'strict',
    });
    const style = document.createElement('style');
    style.dataset.tauriNativeVideoBackdropStyle = '';
    style.textContent = holeStyle(owner);
    layer.append(style);
    document.body.prepend(layer);
    const state = {
        owner,
        anchor,
        originalAnchorVisibility: anchor.style.visibility,
        layer,
        style,
        drilled: [],
        rootHadClass: root.classList.contains('tauri-native-video'),
        previousSession: root.dataset.tauriNativeVideoSession,
        anchorRadii: readCornerRadiusStyles(anchor),
        occluders: [],
        protectedElements: new Set(),
    };
    rebuildAncestors(state, collectAncestors(anchor));
    root.dataset.tauriNativeVideoSession = owner;
    root.classList.add('tauri-native-video');
    nativeCssSurfaceScope.__TAURI_VIDEO_NATIVE_CSS_SURFACE__ = state;
    rebuildOccluders(state);
}
function rebuildAncestors(state, elements) {
    for (const ancestor of state.drilled)
        restoreAncestor(ancestor, state.owner);
    state.drilled = [];
    // The outer background paints first, then progressively more local surfaces.
    for (const element of [...elements].reverse()) {
        const ancestor = createAncestor(element, state.owner);
        state.drilled.unshift(ancestor);
        state.layer.append(ancestor.mirror);
    }
}
function rebuildOccluders(state) {
    for (const occluder of state.occluders)
        restoreOccluder(occluder);
    state.occluders = [];
    const protectedElements = new Set();
    protectPath(state.anchor, protectedElements);
    for (const controls of document.querySelectorAll(`[${VIDEO_CONTROLS_ATTRIBUTE}]`)) {
        protectPath(controls, protectedElements);
    }
    state.protectedElements = protectedElements;
    const visit = (element) => {
        if (element === state.layer || !element.isConnected)
            return;
        if (element === state.anchor || element.hasAttribute(VIDEO_CONTROLS_ATTRIBUTE))
            return;
        if (protectedElements.has(element)) {
            for (const child of element.children) {
                if (child instanceof HTMLElement)
                    visit(child);
            }
            return;
        }
        if (element instanceof HTMLScriptElement || element instanceof HTMLStyleElement)
            return;
        state.occluders.push({
            element,
            owner: state.owner,
            active: false,
            previousOwner: element.getAttribute(OCCLUDER_ATTRIBUTE),
            previousImage: inlineProperty(element, MASK_IMAGE_PROPERTY),
            previousPosition: inlineProperty(element, MASK_POSITION_PROPERTY),
            previousSize: inlineProperty(element, MASK_SIZE_PROPERTY),
        });
    };
    for (const child of document.body.children) {
        if (child instanceof HTMLElement)
            visit(child);
    }
    if (state.lastBounds) {
        for (const occluder of state.occluders) {
            commitOccluder(occluder, rectFrom(occluder.element.getBoundingClientRect()), state.lastBounds);
        }
    }
}
function protectPath(element, protectedElements) {
    for (let current = element; current; current = current.parentElement) {
        protectedElements.add(current);
    }
}
function createAncestor(element, owner) {
    const mirror = document.createElement('div');
    mirror.dataset.tauriNativeVideoBackground = '';
    Object.assign(mirror.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        overflow: 'hidden',
        pointerEvents: 'none',
    });
    const ancestor = {
        element,
        previousOwner: element.getAttribute('data-tauri-native-video-hole'),
        mirror,
        panels: [],
        clipsX: false,
        clipsY: false,
        borderLeft: 0,
        borderTop: 0,
        borderRight: 0,
        borderBottom: 0,
        radii: ZERO_RADIUS_STYLES,
        paintsBackground: false,
    };
    const background = readBackground(element);
    element.setAttribute('data-tauri-native-video-hole', owner);
    applyBackground(ancestor, background);
    return ancestor;
}
function releaseSurface(owner) {
    const state = nativeCssSurfaceScope.__TAURI_VIDEO_NATIVE_CSS_SURFACE__;
    if (!state || state.owner !== owner)
        return;
    state.anchor.style.visibility = state.originalAnchorVisibility;
    for (const ancestor of state.drilled)
        restoreAncestor(ancestor, owner);
    for (const occluder of state.occluders)
        restoreOccluder(occluder);
    state.layer.remove();
    const root = document.documentElement;
    if (state.previousSession === undefined)
        delete root.dataset.tauriNativeVideoSession;
    else
        root.dataset.tauriNativeVideoSession = state.previousSession;
    if (!state.rootHadClass)
        root.classList.remove('tauri-native-video');
    for (const property of NATIVE_VIDEO_CSS_PROPERTIES)
        root.style.removeProperty(property);
    delete nativeCssSurfaceScope.__TAURI_VIDEO_NATIVE_CSS_SURFACE__;
}
function restoreAncestor(ancestor, owner) {
    if (ancestor.element.getAttribute('data-tauri-native-video-hole') === owner) {
        if (ancestor.previousOwner === null)
            ancestor.element.removeAttribute('data-tauri-native-video-hole');
        else
            ancestor.element.setAttribute('data-tauri-native-video-hole', ancestor.previousOwner);
    }
    ancestor.mirror.remove();
}
function restoreOccluder(occluder) {
    if (!occluder.active)
        return;
    if (occluder.element.getAttribute(OCCLUDER_ATTRIBUTE) === occluder.owner) {
        if (occluder.previousOwner === null)
            occluder.element.removeAttribute(OCCLUDER_ATTRIBUTE);
        else
            occluder.element.setAttribute(OCCLUDER_ATTRIBUTE, occluder.previousOwner);
    }
    restoreInlineProperty(occluder.element, MASK_IMAGE_PROPERTY, occluder.previousImage);
    restoreInlineProperty(occluder.element, MASK_POSITION_PROPERTY, occluder.previousPosition);
    restoreInlineProperty(occluder.element, MASK_SIZE_PROPERTY, occluder.previousSize);
    occluder.active = false;
}
function collectAncestors(anchor) {
    const elements = [];
    for (let element = anchor.parentElement; element; element = element.parentElement) {
        elements.push(element);
    }
    return elements;
}
function removeOrphanedSurfaceNodes() {
    for (const orphan of document.querySelectorAll('[data-tauri-native-video-backdrop]'))
        orphan.remove();
    for (const orphan of document.querySelectorAll('[data-tauri-native-video-hole]')) {
        orphan.removeAttribute('data-tauri-native-video-hole');
    }
}
function holeStyle(owner) {
    return `
    [data-tauri-native-video-hole="${owner}"] { background: transparent !important; }
    body[data-tauri-native-video-hole="${owner}"] { position: relative !important; isolation: isolate !important; }
    [${OCCLUDER_ATTRIBUTE}="${owner}"] {
      -webkit-mask-image: var(${MASK_IMAGE_PROPERTY}) !important;
      -webkit-mask-position: var(${MASK_POSITION_PROPERTY}) !important;
      -webkit-mask-size: var(${MASK_SIZE_PROPERTY}) !important;
      -webkit-mask-repeat: no-repeat !important;
      -webkit-mask-origin: border-box !important;
      -webkit-mask-clip: border-box !important;
      -webkit-mask-composite: source-over !important;
      mask-image: var(${MASK_IMAGE_PROPERTY}) !important;
      mask-position: var(${MASK_POSITION_PROPERTY}) !important;
      mask-size: var(${MASK_SIZE_PROPERTY}) !important;
      mask-repeat: no-repeat !important;
      mask-origin: border-box !important;
      mask-clip: border-box !important;
      mask-composite: add !important;
      mask-mode: alpha !important;
    }
  `;
}
function rectFrom(rect) {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

// Adapted from get-air/tauri-video-plugin at 6baf19ff (MIT OR Apache-2.0).
function stylesheetMutation(record) {
    if (record.target instanceof HTMLStyleElement)
        return true;
    return someChangedNode(record, (node) => (node instanceof HTMLStyleElement
        || (node instanceof HTMLLinkElement && node.rel === 'stylesheet')));
}
function structuralMutation(record, state) {
    if (record.type !== 'childList')
        return false;
    if (record.target instanceof HTMLElement && state.protectedElements.has(record.target))
        return true;
    return someChangedNode(record, (node) => (node === state.anchor
        || (node instanceof Element && (node.contains(state.anchor)
            || node.matches(`[${VIDEO_CONTROLS_ATTRIBUTE}]`)
            || Boolean(node.querySelector(`[${VIDEO_CONTROLS_ATTRIBUTE}]`))))));
}
function nativeCoordinateMutation(record) {
    if (record.target !== document.documentElement || record.attributeName !== 'style')
        return false;
    return withoutNativeCoordinates(record.oldValue ?? '')
        === withoutNativeCoordinates(document.documentElement.getAttribute('style') ?? '');
}
function withoutNativeCoordinates(style) {
    return style
        .replace(/--tauri-native-video-(?:left|top|right|bottom|width|height)\s*:[^;]*(?:;|$)/gi, '')
        .replace(/\s+/g, '');
}
function mutationContains(record, anchor) {
    if (record.target instanceof Node && record.target.contains(anchor))
        return true;
    return someChangedNode(record, (node) => (node === anchor || (node instanceof Node && node.contains(anchor))));
}
function someChangedNode(record, predicate) {
    for (const node of record.addedNodes)
        if (predicate(node))
            return true;
    for (const node of record.removedNodes)
        if (predicate(node))
            return true;
    return false;
}

// Adapted from get-air/tauri-video-plugin at 6baf19ff (MIT OR Apache-2.0).
/**
 * Owns the transparent aperture and exact background reconstruction around it.
 * Reads happen in `measure`; DOM writes happen in `commit`, keeping every
 * animation frame free of read/write layout thrashing.
 */
class NativeSurfaceCompositor {
    #owner;
    #anchor;
    constructor(owner, anchor) {
        this.#owner = owner;
        this.#anchor = anchor;
        claimSurface(owner, anchor);
        anchor.style.visibility = 'hidden';
    }
    measure(layout, scale) {
        const state = this.#state();
        const surfaceBounds = {
            left: layout.x / scale,
            top: layout.y / scale,
            right: (layout.x + layout.width) / scale,
            bottom: (layout.y + layout.height) / scale,
        };
        let bounds = visibleSurfaceBounds(layout, scale, {
            width: window.innerWidth,
            height: window.innerHeight,
        });
        let radii = radiiForIntersection(bounds, surfaceBounds, parseCornerRadii(state?.anchorRadii ?? ZERO_RADIUS_STYLES, surfaceBounds));
        if (!state)
            return {
                bounds,
                width: layout.width / scale,
                height: layout.height / scale,
                radii,
                ancestors: [],
                occluders: [],
            };
        const ancestors = state.drilled.map(({ element }) => ({
            element,
            rect: rectFrom(element.getBoundingClientRect()),
        }));
        const occluders = state.occluders.map(({ element }) => ({
            element,
            rect: rectFrom(element.getBoundingClientRect()),
        }));
        for (let index = 0; index < ancestors.length; index += 1) {
            const ancestor = state.drilled[index];
            const clip = ancestorClip(ancestors[index].rect, ancestor);
            if (!clip)
                continue;
            const nextBounds = intersectBounds(bounds, clip);
            radii = mergeIntersectionRadii(bounds, radii, nextBounds, clip, innerCornerRadii(ancestor, ancestors[index].rect));
            bounds = nextBounds;
        }
        return {
            bounds,
            width: layout.width / scale,
            height: layout.height / scale,
            radii,
            ancestors,
            occluders,
        };
    }
    commit(frame) {
        const state = this.#state();
        if (!state)
            return;
        state.lastBounds = frame.bounds;
        for (let index = 0; index < state.drilled.length; index += 1) {
            const ancestor = state.drilled[index];
            const measured = frame.ancestors[index];
            if (measured?.element !== ancestor.element)
                continue;
            commitAncestor(ancestor, measured.rect, frame.bounds, frame.radii);
        }
        for (let index = 0; index < state.occluders.length; index += 1) {
            const occluder = state.occluders[index];
            const measured = frame.occluders[index];
            if (measured?.element !== occluder.element)
                continue;
            commitOccluder(occluder, measured.rect, frame.bounds);
        }
        const root = document.documentElement;
        setProperty(root, '--tauri-native-video-left', `${frame.bounds.left}px`);
        setProperty(root, '--tauri-native-video-top', `${frame.bounds.top}px`);
        setProperty(root, '--tauri-native-video-right', `${frame.bounds.right}px`);
        setProperty(root, '--tauri-native-video-bottom', `${frame.bounds.bottom}px`);
        setProperty(root, '--tauri-native-video-width', `${frame.width}px`);
        setProperty(root, '--tauri-native-video-height', `${frame.height}px`);
    }
    /** Re-reads backgrounds and repairs the ancestor chain after DOM changes. */
    refresh() {
        const state = this.#state();
        if (!state)
            return;
        const elements = collectAncestors(this.#anchor);
        const chainChanged = elements.length !== state.drilled.length
            || elements.some((element, index) => state.drilled[index]?.element !== element);
        if (chainChanged)
            rebuildAncestors(state, elements);
        else
            refreshBackgrounds(state);
        rebuildOccluders(state);
    }
    /**
     * Watches only mutations that can move the anchor or change a drilled
     * background. Unrelated component updates do not enter the layout path.
     */
    observe(onInvalidated) {
        if (typeof MutationObserver === 'undefined')
            return () => undefined;
        const observer = new MutationObserver((records) => {
            const state = this.#state();
            if (!state)
                return;
            let layoutChanged = false;
            let backgroundChanged = false;
            for (const record of records) {
                if (record.type === 'attributes') {
                    if (nativeCoordinateMutation(record))
                        continue;
                    if (record.target === this.#anchor
                        || state.drilled.some(({ element }) => element === record.target)) {
                        layoutChanged = true;
                        backgroundChanged = true;
                    }
                    continue;
                }
                if (stylesheetMutation(record) || structuralMutation(record, state))
                    backgroundChanged = true;
                if (state.drilled.some(({ element }) => element === record.target)
                    || mutationContains(record, this.#anchor)) {
                    layoutChanged = true;
                }
            }
            if (layoutChanged || backgroundChanged)
                onInvalidated(backgroundChanged);
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeOldValue: true,
            attributeFilter: ['class', 'style'],
            childList: true,
            subtree: true,
        });
        return () => observer.disconnect();
    }
    release() {
        releaseSurface(this.#owner);
    }
    #state() {
        const state = nativeCssSurfaceScope.__TAURI_VIDEO_NATIVE_CSS_SURFACE__;
        return state?.owner === this.#owner && state.anchor === this.#anchor ? state : undefined;
    }
}
function ancestorClip(rect, ancestor) {
    if (!ancestor.clipsX && !ancestor.clipsY)
        return undefined;
    // Root overflow clips the viewport, not the body's content box. Apps with
    // absolutely positioned content can have a zero-height body.
    if (ancestor.element === document.body || ancestor.element === document.documentElement) {
        return {
            left: 0,
            top: 0,
            right: window.innerWidth,
            bottom: window.innerHeight,
        };
    }
    return {
        left: ancestor.clipsX ? rect.left + ancestor.borderLeft : Number.NEGATIVE_INFINITY,
        top: ancestor.clipsY ? rect.top + ancestor.borderTop : Number.NEGATIVE_INFINITY,
        right: ancestor.clipsX
            ? rect.left + rect.width - ancestor.borderRight
            : Number.POSITIVE_INFINITY,
        bottom: ancestor.clipsY
            ? rect.top + rect.height - ancestor.borderBottom
            : Number.POSITIVE_INFINITY,
    };
}
function innerCornerRadii(ancestor, rect) {
    if (!ancestor.clipsX || !ancestor.clipsY)
        return ZERO_RADII;
    const radii = parseCornerRadii(ancestor.radii, {
        left: rect.left,
        top: rect.top,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
    });
    return [
        subtractRadius(radii[0], ancestor.borderLeft, ancestor.borderTop),
        subtractRadius(radii[1], ancestor.borderRight, ancestor.borderTop),
        subtractRadius(radii[2], ancestor.borderRight, ancestor.borderBottom),
        subtractRadius(radii[3], ancestor.borderLeft, ancestor.borderBottom),
    ];
}

/** Preserve upstream background reconstruction and protected video overlays. */
class NativeAperture {
    constructor(anchor) {
        this.anchor = anchor;
    }
    open(layout) {
        this.close();
        this.compositor = new NativeSurfaceCompositor(crypto.randomUUID(), this.anchor);
        if (layout)
            this.publish(layout);
    }
    observe(invalidated) {
        return this.compositor?.observe(invalidated) ?? (() => undefined);
    }
    refresh() { this.compositor?.refresh(); }
    close() {
        this.compositor?.release();
        this.compositor = undefined;
    }
    publish(layout) {
        const frame = this.compositor?.measure(layout, 1);
        if (frame)
            this.compositor?.commit(frame);
    }
}

const TAURI_NATIVE_PLAYER_CAPABILITIES = {
    platform: 'tauri',
    engine: 'tauri-plugin-video (native GStreamer)',
    directNative: 'supported',
    adaptiveStreaming: 'supported',
    drm: 'unsupported',
    canSetVolume: true,
    canPause: true,
    canSeek: true,
    canSelectAudioTrack: true,
    canSelectTextTrack: true,
    canDisableTextTrack: true,
    canUseCookies: true,
    canUseUserAgent: true,
    limitations: [
        'Native engine, codec and HDR support are runtime facts of the installed GStreamer build; the delivery profile only declares what the engine is expected to play.',
        'The native command protocol exposes no playback-rate change and no buffering signal; neither is reported or emulated.',
        'Cookies and a user agent are engine request properties, not arbitrary header support.',
        'Live windows are playable but expose no VOD seek bar, matching the other adapters.',
    ],
};
/**
 * The desktop no-transcode delivery profile handed to the backend's session
 * ladder: a broad native codec and container set with direct delivery
 * preferred. The server's own container, single-stream and HDR rules still
 * decide the rung; this client never requests managed-only or forced output.
 */
const TAURI_NATIVE_DELIVERY_CAPABILITIES = {
    maxWidth: 3840,
    maxHeight: 2160,
    h264: true,
    hevc: true,
    aac: true,
    hevcSdr: true,
    directPlay: true,
    directUrls: true,
    directMp4: true,
    directHls: true,
    directFiles: true,
    directVideoCodecs: ['avc', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg2video', 'mpeg4', 'theora', 'prores', 'mjpeg'],
    directAudioCodecs: ['aac', 'opus', 'mp3', 'vorbis', 'flac', 'ac3', 'eac3', 'dts', 'truehd', 'pcm'],
};

let nativeSessionSequence = 0;
function webView2TextureStream() {
    const scope = globalThis;
    const getTextureStream = scope.chrome?.webview?.getTextureStream;
    return typeof getTextureStream === 'function'
        ? { getTextureStream: getTextureStream.bind(scope.chrome?.webview) }
        : undefined;
}
function newSessionKey() {
    return globalThis.crypto?.randomUUID?.()
        ?? `viptv-native-${Date.now()}-${++nativeSessionSequence}`;
}
function isWireError(value) {
    return typeof value === 'object'
        && value !== null
        && typeof value.code === 'string'
        && typeof value.message === 'string';
}
/** The plugin's serialized engine failures map onto the shared Player codes. */
function playerErrorCodeFor(wireCode, fallback) {
    switch (wireCode) {
        case 'PROTOCOL_MISMATCH':
        case 'RUNTIME_UNAVAILABLE':
            return 'engine-unavailable';
        case 'PIPELINE_FAILED':
        case 'SOURCE_OPEN_FAILED':
            return 'prepare-failed';
        // Only explicit media/decoder failures justify delivery conversion.
        case 'DECODE_FAILED':
        case 'MEDIA_FORMAT_FAILED':
            return 'unsupported-format';
        case 'VIDEO_OUTPUT_FAILED':
        case 'AUDIO_OUTPUT_FAILED':
            return 'engine-unavailable';
        case 'PROTECTED_MEDIA': return 'authorization-unsupported';
        case 'AUTHORIZATION_FAILED': return 'authorization-failed';
        case 'CONNECTION_FAILED': return 'connection-failed';
        case 'SOURCE_UNAVAILABLE': return 'expired-source';
        case 'INVALID_REQUEST':
            return 'prepare-failed';
        default:
            return fallback;
    }
}
function nativeOperationError(cause, fallback, message) {
    if (isWireError(cause)) {
        // Older plugin builds mislabeled all pipeline failures as decoder errors.
        // Keep the caller's operation context for that ambiguous legacy code.
        return new PlayerOperationError(playerErrorCodeFor(cause.code, fallback), cause.code === 'PIPELINE_FAILED' && cause.message === 'The native player could not decode this media delivery.' ? message : cause.message, cause);
    }
    return new PlayerOperationError(fallback, message, cause);
}
function hlsish(url) {
    return /\.m3u8(?:[?#]|$)/i.test(url);
}
function nativeDiagnostics(url, backend) {
    return {
        engine: 'tauri-native',
        networkTransport: 'direct',
        transport: hlsish(url) ? 'hls' : 'file',
        ...(backend && backend.length > 0 ? { backend } : {}),
    };
}
function engineDuration(snapshot, kind) {
    return snapshot && kind !== 'live' && (kind === 'vod' || !snapshot.live) && snapshot.durationSeconds > 0
        ? snapshot.durationSeconds
        : null;
}
function hasEnded(snapshot, kind) {
    return Boolean(snapshot
        && kind !== 'live' && (kind === 'vod' || !snapshot.live)
        && snapshot.durationSeconds > 0
        && snapshot.currentTimeSeconds >= snapshot.durationSeconds);
}
function selectedCodec(snapshot, kind) {
    const track = snapshot.tracks.find(candidate => candidate.kind === kind && candidate.selected);
    return track && track.codec.length > 0 ? track.codec : undefined;
}
function sameLayout(a, b) {
    return a !== undefined && b !== undefined
        && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
function tracksFromNative(tracks) {
    const audio = [];
    const text = [];
    let selectedAudioId = null;
    let selectedTextId = null;
    const counts = { audio: 0, text: 0 };
    for (const track of tracks) {
        if (track.kind !== 'audio' && track.kind !== 'subtitle')
            continue;
        const kind = track.kind === 'audio' ? 'audio' : 'text';
        const id = `${kind}:${track.index}`;
        const number = ++counts[kind];
        const fallback = `${kind === 'audio' ? 'Audio' : 'Subtitle'} ${number}${track.codec ? ` · ${track.codec}` : ''}`;
        const known = (text) => text.trim().length > 0 && !/^(und|unknown|undefined|audio|video|subtitle)$/i.test(text.trim());
        const entry = {
            id,
            label: [track.label, track.language].find(known) ?? fallback,
            language: known(track.language) ? track.language : undefined,
            available: true,
        };
        if (kind === 'audio')
            audio.push(entry);
        else
            text.push(entry);
        if (track.selected) {
            if (kind === 'audio')
                selectedAudioId = id;
            else
                selectedTextId = id;
        }
    }
    return { audio, text, selectedAudioId, selectedTextId };
}

/**
 * The desktop playback seam. It implements the same Player contract as the TV
 * adapters directly over the raw tauri-plugin-video IPC commands
 * (`plugin:video|native_*`), so no @get-air/video dependency enters this
 * bundle: the command payloads, snapshots and wire errors are exactly the ones
 * the plugin's Rust side declares (tauri-plugin-video 0.4, protocol 1).
 *
 * What that engine actually exposes, and what this adapter honestly does not:
 * the native engines render through their own surface — a GTK GPU widget under
 * a WebView aperture on Linux, a WebView2 texture stream on the real video
 * element on Windows — never a canvas. Playback-rate changes and a buffering
 * signal are not part of the command protocol, so neither is reported nor
 * emulated here.
 */
const TAURI_VIDEO_PROTOCOL_VERSION = 1;
/** Identifies this adapter in native_open; the Rust gate only requires presence. */
const ADAPTER_PACKAGE_VERSION = 'viptv-tv-web-tauri-native';
const COMMAND = 'plugin:video|';
const FIRST_FRAME_TIMEOUT_MS = 8000;
function isTauriRuntime() {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
/** Resolves the real plugin bridge; outside Tauri this is an honest failure. */
function resolveTauriVideoInvoker() {
    if (!isTauriRuntime()) {
        throw new PlayerOperationError('engine-unavailable', 'The native Tauri video engine is unavailable outside the desktop app.');
    }
    return { invoke };
}
function tauriNativePlatform() {
    if (/Windows/i.test(navigator.userAgent))
        return 'windows';
    if (/Linux|X11/i.test(navigator.userAgent))
        return 'linux';
    return undefined;
}
/**
 * The native engine keeps its own surface aligned with the anchor element: on
 * Linux the plugin places a GTK widget under a WebView aperture at the
 * element's CSS rectangle, so every layout change is forwarded through
 * native_layout and the DOM stack above the video is made transparent while a
 * native session is live.
 */
class TauriNativeAdapter extends SessionPlayer {
    constructor(anchor, invoker = resolveTauriVideoInvoker(), options = {}) {
        super();
        this.anchor = anchor;
        this.capabilities = TAURI_NATIVE_PLAYER_CAPABILITIES;
        this.seekGeneration = 0;
        this.pictureMode = 'fit';
        this.requestedPlaying = false;
        this.protocolVerified = false;
        this.volume = 1;
        this.muted = false;
        this.timelineOffsetSeconds = 0;
        this.adoptEngineDuration = false;
        this.observedTitleDuration = null;
        this.layoutDirty = false;
        this.compositorDirty = false;
        this.layoutInFlight = false;
        this.handleViewportChange = () => this.requestLayout();
        this.invoker = invoker;
        this.platform = options.platform ?? tauriNativePlatform();
        this.engine = options.engine ?? 'auto';
        this.aperture = new NativeAperture(anchor);
    }
    async open(request) {
        const authorization = checkedSourceAuthorization(request.authorization);
        await this.teardownNative();
        this.invalidateSession();
        const sessionId = this.startSession(request.kind);
        this.request = request;
        this.timelineOffsetSeconds = nonNegative(request.timelineOffsetSeconds ?? 0);
        this.timelineDurationSeconds = request.timelineDurationSeconds;
        this.adoptEngineDuration = request.adoptEngineDuration === true;
        this.observedTitleDuration = null;
        this.requestedPlaying = request.paused !== true;
        this.update(sessionId, {
            diagnostics: nativeDiagnostics(request.url),
            volume: { level: this.volume, muted: this.muted },
        });
        const sessionKey = newSessionKey();
        let established = false;
        try {
            const platform = this.requireNativePlatform();
            await this.verifyProtocol();
            if (!this.isCurrent(sessionId))
                return;
            // Windows renders GStreamer D3D11 frames as a WebView2 texture stream on
            // the real video element; Linux places the native surface below the
            // WebView and hides the anchor element itself.
            let texture;
            let textureBootstrap = false;
            if (platform === 'windows') {
                const api = webView2TextureStream();
                if (!api) {
                    throw new PlayerOperationError('engine-unavailable', 'This WebView2 runtime does not expose GPU texture streams on the video element.');
                }
                const streamId = await this.invoker.invoke(`${COMMAND}native_prepare_texture_stream`, { sessionKey });
                if (!this.isCurrent(sessionId))
                    return;
                texture = api.getTextureStream(streamId);
                textureBootstrap = request.paused === true;
            }
            const layout = this.measureLayout();
            this.lastLayout = layout;
            const backend = this.resolveBackend();
            const payload = {
                protocolVersion: TAURI_VIDEO_PROTOCOL_VERSION,
                packageVersion: ADAPTER_PACKAGE_VERSION,
                sessionKey,
                uri: request.url,
                startAtSeconds: Math.max(0, request.startAtSeconds ?? 0),
                x: layout.x,
                y: layout.y,
                width: layout.width,
                height: layout.height,
                scrollX: 0,
                scrollY: 0,
                autoplay: texture !== undefined || this.requestedPlaying,
                volume: textureBootstrap ? 0 : this.volume,
                muted: this.muted,
                ...(authorization?.cookie ? { cookies: authorization.cookie } : {}),
                ...(authorization?.userAgent ? { userAgent: authorization.userAgent } : {}),
                ...(authorization?.headers ? { headers: authorization.headers } : {}),
                ...(backend !== undefined ? { backend } : {}),
            };
            this.startupRetry = { payload, retried: false, completed: false };
            const snapshot = await this.openNativeSession(sessionKey, payload, sessionId);
            if (!this.isCurrent(sessionId))
                return;
            established = true;
            this.sessionKey = sessionKey;
            this.native = snapshot;
            if (this.pictureMode === 'fill') {
                const cropped = await this.control('crop');
                if (!this.isCurrent(sessionId) || this.sessionKey !== sessionKey)
                    return;
                this.acceptSnapshot(cropped);
            }
            // The engine reports which backend actually serves the session; surface
            // it in diagnostics so a host shows the running engine, not just the
            // requested one.
            this.update(sessionId, {
                diagnostics: nativeDiagnostics(request.url, snapshot.backend),
            });
            if (texture) {
                this.textureStream = await texture;
                this.anchor.srcObject = this.textureStream;
                this.anchor.autoplay = true;
                this.anchor.playsInline = true;
                if (textureBootstrap) {
                    // The stream becomes visible before the pipeline has prerolled; give
                    // it a moment, then honor the paused request and start position.
                    await delay(500);
                    if (!this.isCurrent(sessionId))
                        return;
                    this.acceptSnapshot(await this.control('pause'));
                    this.acceptSnapshot(await this.control('seek', boundedPosition(request.startAtSeconds ?? 0, engineDuration(snapshot, this.request?.kind))));
                    this.acceptSnapshot(await this.control('volume', this.muted ? 0 : this.volume));
                }
            }
            else {
                const startAt = boundedPosition(request.startAtSeconds ?? 0, engineDuration(snapshot, this.request?.kind));
                // A newly opened native pipeline may infer live from an unknown
                // duration before preroll. The selected request owns VOD/live intent.
                // mpv applies startAtSeconds through its native `start` option while
                // loading. loadfile returns before file-loaded; a second seek here
                // races demuxer initialization and fails with MPV_ERROR_COMMAND (-12).
                if (startAt > 0 && request.kind !== 'live' && snapshot.backend !== 'mpv') {
                    this.acceptSnapshot(await this.control('seek', startAt));
                }
            }
            if (!this.isCurrent(sessionId))
                return;
            this.publishSnapshot(sessionId, this.native);
            this.update(sessionId, { error: null });
            if (platform !== 'windows')
                this.aperture.open(this.lastLayout);
            this.startLayoutTracking();
            this.startPolling();
            this.watchFirstFrame(sessionId, request);
            if (this.native.playing)
                this.update(sessionId, { state: 'playing' });
            else if (request.paused === true)
                this.update(sessionId, { state: 'paused' });
            else
                this.update(sessionId, { state: 'ready' });
        }
        catch (cause) {
            const error = cause instanceof PlayerOperationError
                ? cause
                : nativeOperationError(cause, 'connection-failed', 'The native video engine could not open the selected source.');
            this.fail(sessionId, error.toFailure());
            await this.teardownNative();
            throw error;
        }
        finally {
            // A session that never established must not keep a native engine attached.
            if (!established)
                await this.closeSession(sessionKey);
        }
    }
    async play() {
        const sessionId = this.activeSessionOrThrow();
        this.requestedPlaying = true;
        try {
            const snapshot = this.acceptSnapshot(await this.control('play'));
            if (!this.isCurrent(sessionId))
                return;
            this.publishSnapshot(sessionId, snapshot);
            this.update(sessionId, { state: 'playing', error: null });
        }
        catch (cause) {
            this.throwOperation(sessionId, 'prepare-failed', 'The native engine could not resume playback.', cause);
        }
    }
    async pause() {
        const sessionId = this.activeSessionOrThrow();
        this.requestedPlaying = false;
        try {
            const snapshot = this.acceptSnapshot(await this.control('pause'));
            if (!this.isCurrent(sessionId))
                return;
            this.publishSnapshot(sessionId, snapshot);
            this.update(sessionId, { state: 'paused' });
        }
        catch (cause) {
            this.throwOperation(sessionId, 'prepare-failed', 'The native engine could not pause playback.', cause);
        }
    }
    async seek(positionSeconds) {
        const sessionId = this.activeSessionOrThrow();
        if (this.request?.kind === 'live') {
            throw new PlayerOperationError('unsupported-operation', 'Live playback does not expose VOD seeking.');
        }
        if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
            throw new PlayerOperationError('seek-failed', 'Seek position must be a non-negative number.');
        }
        const native = this.native;
        // The engine is the authority: it reports refusal honestly, and mpv can
        // still serve seeks within its demuxer cache for unseekable media.
        const duration = engineDuration(native, this.request?.kind);
        let target = boundedPosition(positionSeconds - this.timelineOffsetSeconds, duration);
        if (native) {
            const minimum = Math.max(0, native.seekableStartSeconds ?? 0);
            if (native.seekable === false) {
                // Unseekable media: only the engine's reported window (the demuxer
                // cache) can serve a seek. A target beyond it must refuse honestly;
                // dispatching it makes the origin replay the beginning instead.
                const maximum = native.seekableEndSeconds;
                if (maximum === undefined || !Number.isFinite(maximum) || target < minimum || target > maximum) {
                    // A refusal is an operation failure, not a session failure: the
                    // engine keeps playing, and a sticky session error would re-pop
                    // the error surface on every poll beat.
                    throw new PlayerOperationError('seek-failed', 'This stream cannot seek there: the origin does not support seeking and the engine has not buffered that range.');
                }
            }
            else {
                // Seekable media: the engine seeks through the origin directly;
                // only the title bounds apply.
                target = Math.max(target, minimum);
            }
        }
        const before = this.snapshot.time.positionSeconds - this.timelineOffsetSeconds;
        const generation = ++this.seekGeneration;
        this.pendingSeek = { generation, target };
        const sessionKey = this.sessionKey;
        // A lying origin answers the seek's range request by replaying the
        // stream from the beginning: the position lands far below both the
        // target and the pre-seek position instead of near the target.
        const restartToleranceSeconds = 2;
        try {
            let snapshot = await this.control('seek', target);
            const checkRefusal = () => {
                if (snapshot.controlFailure === 'seek') {
                    throw new PlayerOperationError('seek-failed', 'The native engine refused the requested seek.');
                }
            };
            const current = () => this.isCurrent(sessionId) && this.sessionKey === sessionKey && this.seekGeneration === generation;
            if (!current())
                return;
            checkRefusal();
            const replayed = () => snapshot.currentTimeSeconds + restartToleranceSeconds < target
                && snapshot.currentTimeSeconds + restartToleranceSeconds < before;
            // Flushing decoders can acknowledge at zero before asynchronous seek
            // completion. Confirm with bounded engine observations before reporting
            // that the origin replayed the beginning. No position is fabricated.
            const landed = () => Math.abs(snapshot.currentTimeSeconds - target) <= 1.5;
            for (let attempt = 0; !landed() && attempt < 80; attempt++) {
                await delay(75);
                if (!current())
                    return;
                snapshot = await this.invoker.invoke(`${COMMAND}native_stats`, { payload: { sessionKey } });
                if (!current())
                    return;
                checkRefusal();
                if (replayed() && attempt >= 19)
                    break;
            }
            if (!landed()) {
                // The engine restarted the stream instead of landing the seek; it
                // is still playing, so this reaches the caller without failing the
                // session.
                throw new PlayerOperationError('seek-failed', replayed() ? 'The stream replayed from its beginning instead of seeking; the origin cannot serve that position.' : 'The engine did not confirm the requested seek position.');
            }
            this.acceptSnapshot(snapshot);
            this.publishSnapshot(sessionId, snapshot);
        }
        catch (cause) {
            if (cause instanceof PlayerOperationError)
                throw cause;
            this.throwOperation(sessionId, 'seek-failed', 'The native engine could not seek the selected source.', cause);
        }
        finally {
            if (this.pendingSeek?.generation === generation)
                this.pendingSeek = undefined;
        }
    }
    async setPictureMode(mode) {
        this.pictureMode = mode;
        if (this.sessionKey === undefined)
            return;
        const sessionId = this.snapshot.sessionId;
        try {
            const snapshot = await this.control(mode === 'fill' ? 'crop' : 'fit');
            if (!this.isCurrent(sessionId))
                return;
            this.acceptSnapshot(snapshot);
            this.publishSnapshot(sessionId, snapshot);
        }
        catch (cause) {
            throw nativeOperationError(cause, 'unsupported-operation', 'The native engine could not change the picture mode.');
        }
    }
    async setVolume(level) {
        this.volume = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 1));
        if (this.volume > 0)
            this.muted = false;
        await this.applyVolume();
    }
    async setMuted(muted) {
        this.muted = muted;
        await this.applyVolume();
    }
    async stop() {
        this.invalidateSession();
        // Clear presentation facts before native teardown can wait on the host.
        this.terminal('stopped');
        await this.teardownNative();
    }
    async dispose() {
        await this.stop();
        this.terminal('disposed');
    }
    async selectAudioTrack(trackId) {
        const sessionId = this.activeSessionOrThrow();
        const index = this.trackIndex('audio', trackId);
        try {
            const snapshot = this.acceptSnapshot(await this.control('track', 0, index));
            if (!this.isCurrent(sessionId))
                return;
            this.publishSnapshot(sessionId, snapshot);
        }
        catch (cause) {
            this.throwOperation(sessionId, 'unsupported-operation', `The native engine could not select audio track ${trackId}.`, cause);
        }
    }
    async selectTextTrack(trackId) {
        const sessionId = this.activeSessionOrThrow();
        if (trackId === null) {
            const active = this.native?.tracks.find(track => track.kind === 'subtitle' && track.selected);
            if (!active) {
                this.update(sessionId, { tracks: { ...this.snapshot.tracks, selectedTextId: null } });
                return;
            }
            try {
                const snapshot = this.acceptSnapshot(await this.control('deselectTrack', 0, active.index));
                if (!this.isCurrent(sessionId))
                    return;
                this.publishSnapshot(sessionId, snapshot);
            }
            catch (cause) {
                this.throwOperation(sessionId, 'unsupported-operation', 'The native engine could not disable subtitles.', cause);
            }
            return;
        }
        const index = this.trackIndex('text', trackId);
        try {
            const snapshot = this.acceptSnapshot(await this.control('track', 0, index));
            if (!this.isCurrent(sessionId))
                return;
            this.publishSnapshot(sessionId, snapshot);
        }
        catch (cause) {
            this.throwOperation(sessionId, 'unsupported-operation', `The native engine could not select subtitle track ${trackId}.`, cause);
        }
    }
    requireNativePlatform() {
        if (this.platform !== 'linux' && this.platform !== 'windows') {
            throw new PlayerOperationError('engine-unavailable', 'Native video playback is supported on the Linux and Windows desktop builds.');
        }
        return this.platform;
    }
    /** The JS/Rust wire contract is verified before any stateful command runs. */
    async verifyProtocol() {
        if (this.protocolVerified)
            return;
        let diagnostics;
        try {
            diagnostics = await this.invoker.invoke(`${COMMAND}native_diagnostics`);
        }
        catch (cause) {
            throw new PlayerOperationError('engine-unavailable', 'The native video plugin did not answer its diagnostics command.', cause);
        }
        if (!diagnostics || diagnostics.protocolVersion !== TAURI_VIDEO_PROTOCOL_VERSION) {
            const actual = diagnostics && typeof diagnostics.protocolVersion === 'number'
                ? diagnostics.protocolVersion
                : 'unknown';
            throw new PlayerOperationError('engine-unavailable', `The native video plugin reports protocol ${actual}; this adapter requires ${TAURI_VIDEO_PROTOCOL_VERSION}. Update the desktop app and tauri-plugin-video together.`);
        }
        this.nativeEngines = diagnostics.engines;
        this.protocolVerified = true;
    }
    /**
     * Resolves the requested engine into the plugin's backend field. 'auto'
     * follows the plugin's documented preference order (GStreamer first). An
     * explicit engine the diagnostics say is not compiled fails here with a
     * typed `engine-unavailable` error instead of silently playing on another
     * engine; hosts offer only engines from `native_diagnostics`.
     */
    resolveBackend() {
        const engines = this.nativeEngines;
        if (this.engine !== 'auto') {
            if (engines !== undefined && engines.length > 0 && !engines.includes(this.engine)) {
                throw new PlayerOperationError('engine-unavailable', `The ${this.engine} engine is not available in this desktop build.`);
            }
            return this.engine;
        }
        return engines?.find(engine => engine.length > 0);
    }
    /**
     * Opens the native session, retrying the exact same delivery once when the
     * engine could not stand up its pipeline. A flaky provider that truncates
     * its first response (playbin3 typefind "Stream doesn't contain enough
     * data") recovers on a fresh engine session; only a repeated failure
     * reaches the session controller's delivery escalation.
     */
    async openNativeSession(sessionKey, payload, sessionId) {
        try {
            return await this.invoker.invoke(`${COMMAND}native_open`, { payload });
        }
        catch (cause) {
            const error = nativeOperationError(cause, 'connection-failed', 'The native video engine could not open the selected source.');
            const pipelineFailure = cause && typeof cause === 'object' && 'code' in cause && cause.code === 'PIPELINE_FAILED';
            if ((!pipelineFailure && error.code !== 'unsupported-format') || !this.isCurrent(sessionId))
                throw cause;
            if (this.startupRetry)
                this.startupRetry.retried = true;
            // Release whatever the failed attempt attached, then re-open the same
            // request: the session key stays this session's correlation.
            await this.closeSession(sessionKey).catch(() => undefined);
            return await this.invoker.invoke(`${COMMAND}native_open`, { payload });
        }
    }
    async control(action, value = 0, index = -1) {
        const sessionId = this.snapshot.sessionId;
        if (action === 'seek' || action === 'track' || action === 'deselectTrack') {
            this.update(sessionId, { notice: undefined });
        }
        const sessionKey = this.sessionKey;
        if (sessionKey === undefined) {
            throw new PlayerOperationError('invalid-state', 'No active native playback session.');
        }
        const snapshot = await this.invoker.invoke(`${COMMAND}native_control`, {
            payload: { sessionKey, action, value, index },
        });
        if (snapshot.controlFailure && this.sessionKey === sessionKey) {
            this.update(sessionId, { notice: snapshot.controlFailure === 'seek'
                    ? 'The stream could not seek there.' : 'The stream could not change that track.' });
        }
        if (snapshot.controlFailure === 'track' && (action === 'track' || action === 'deselectTrack')) {
            throw new PlayerOperationError('unsupported-operation', 'The native engine refused the requested track.');
        }
        return snapshot;
    }
    acceptSnapshot(snapshot) {
        this.native = snapshot;
        return snapshot;
    }
    publishSnapshot(sessionId, snapshot) {
        if (this.startupRetry && (snapshot.presentedFrames === undefined
            ? snapshot.videoWidth > 0 : snapshot.presentedFrames > 0))
            this.startupRetry.completed = true;
        if ((snapshot.videoWidth ?? 0) > 0)
            this.clearFirstFrameWatchdog();
        this.update(sessionId, {
            time: this.time(snapshot),
            tracks: tracksFromNative(snapshot.tracks),
            diagnostics: this.snapshot.diagnostics
                ? {
                    ...this.snapshot.diagnostics,
                    videoCodec: selectedCodec(snapshot, 'video'),
                    audioCodec: selectedCodec(snapshot, 'audio'),
                    width: snapshot.videoWidth,
                    height: snapshot.videoHeight,
                    presentedFrames: snapshot.presentedFrames,
                    frameTiming: snapshot.presentedFrames === undefined ? 'unavailable' : 'verified',
                }
                : undefined,
        });
    }
    /** The seek bar's length: the server total, raised only by an original file. */
    time(snapshot) {
        const actual = this.timelineOffsetSeconds + Math.max(0, snapshot.currentTimeSeconds);
        const position = this.pendingSeek && Math.abs(snapshot.currentTimeSeconds - this.pendingSeek.target) > 1.5
            ? this.snapshot.time.positionSeconds : actual;
        const duration = engineDuration(snapshot, this.request?.kind);
        const engine = duration !== null ? duration + this.timelineOffsetSeconds : null;
        const next = timelineDuration(this.timelineDurationSeconds, engine, this.adoptEngineDuration);
        this.observedTitleDuration = growOnlyDuration(this.observedTitleDuration, next);
        const lead = snapshot.bufferedSeconds - snapshot.currentTimeSeconds;
        const bufferedEnd = this.request?.kind === 'live' || lead <= 0
            ? null
            : Math.min(snapshot.bufferedSeconds + this.timelineOffsetSeconds, this.observedTitleDuration ?? Number.POSITIVE_INFINITY);
        return {
            positionSeconds: position,
            durationSeconds: this.observedTitleDuration,
            bufferedEndSeconds: bufferedEnd,
            bufferedRanges: snapshot.bufferedRanges?.map(range => ({
                start: Math.max(0, range.start + this.timelineOffsetSeconds),
                end: Math.min(range.end + this.timelineOffsetSeconds, this.observedTitleDuration ?? Infinity),
            })).filter(range => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start),
            seekable: snapshot.seekable,
        };
    }
    applyVolume() {
        const sessionId = this.snapshot.sessionId;
        // The slider reflects the user's current choice while IPC is pending.
        this.update(sessionId, { volume: { level: this.volume, muted: this.muted } });
        const sessionKey = this.sessionKey;
        if (sessionKey === undefined)
            return Promise.resolve();
        if (this.volumeFlush?.sessionKey === sessionKey)
            return this.volumeFlush.promise;
        const flush = { sessionKey, promise: Promise.resolve() };
        this.volumeFlush = flush;
        flush.promise = this.flushVolume(sessionId, flush);
        return flush.promise;
    }
    async flushVolume(sessionId, flush) {
        try {
            while (this.isCurrent(sessionId) && this.sessionKey === flush.sessionKey) {
                const value = this.muted ? 0 : this.volume;
                // Only one volume command can await native IPC. Dragging replaces the
                // pending value rather than queuing every intermediate pointer sample.
                await this.control('volume', value);
                if (value === (this.muted ? 0 : this.volume))
                    return;
            }
        }
        catch (cause) {
            if (!this.isCurrent(sessionId) || this.sessionKey !== flush.sessionKey)
                return;
            this.throwOperation(sessionId, 'prepare-failed', 'The native engine could not change the volume.', cause);
        }
        finally {
            if (this.volumeFlush === flush)
                this.volumeFlush = undefined;
        }
    }
    trackIndex(kind, trackId) {
        const nativeKind = kind === 'audio' ? 'audio' : 'subtitle';
        const track = this.native?.tracks.find(candidate => candidate.kind === nativeKind && `${kind}:${candidate.index}` === trackId);
        if (!track) {
            throw new PlayerOperationError('unsupported-operation', `${kind === 'audio' ? 'Audio' : 'Subtitle'} track ${trackId} is not available.`);
        }
        return track.index;
    }
    throwOperation(sessionId, code, message, cause) {
        const error = cause instanceof PlayerOperationError
            ? cause
            : cause && typeof cause === 'object' && 'code' in cause && cause.code === 'PIPELINE_FAILED'
                ? new PlayerOperationError(code, message, cause)
                : nativeOperationError(cause, code, message);
        // Refusing a control operation does not prove this delivery is undecodable.
        // Keep the active session; actual engine failure arrives through polling.
        throw error;
    }
    startPolling() {
        this.stopPolling();
        this.schedulePoll(0);
    }
    schedulePoll(delayMs) {
        if (this.pollTimer !== undefined || this.sessionKey === undefined)
            return;
        this.pollTimer = setTimeout(async () => {
            this.pollTimer = undefined;
            await this.poll();
            if (this.sessionKey !== undefined && !this.snapshot.error) {
                this.schedulePoll(this.requestedPlaying ? 250 : 1000);
            }
        }, delayMs);
    }
    stopPolling() {
        if (this.pollTimer !== undefined) {
            clearTimeout(this.pollTimer);
            this.pollTimer = undefined;
        }
    }
    async poll() {
        const sessionKey = this.sessionKey;
        if (sessionKey === undefined)
            return;
        const sessionId = this.snapshot.sessionId;
        try {
            const snapshot = await this.invoker.invoke(`${COMMAND}native_stats`, {
                payload: { sessionKey },
            });
            if (this.sessionKey !== sessionKey || !this.isCurrent(sessionId) || this.snapshot.error)
                return;
            const previous = this.native;
            if (snapshot.controlFailure && snapshot.controlFailure !== previous?.controlFailure) {
                this.update(sessionId, { notice: snapshot.controlFailure === 'seek'
                        ? 'The stream could not seek there.' : 'The stream could not change that track.' });
            }
            this.acceptSnapshot(snapshot);
            this.publishSnapshot(sessionId, snapshot);
            if (previous && previous.playing !== snapshot.playing) {
                this.update(sessionId, { state: snapshot.playing ? 'playing' : 'paused' });
            }
            if (!hasEnded(previous, this.request?.kind) && hasEnded(snapshot, this.request?.kind)) {
                this.requestedPlaying = false;
                this.update(sessionId, { state: 'ended' });
            }
        }
        catch (cause) {
            if (!this.isCurrent(sessionId))
                return;
            try {
                if (await this.retryDeferredStartup(sessionId, sessionKey, cause))
                    return;
            }
            catch (retryCause) {
                cause = retryCause;
            }
            if (!this.isCurrent(sessionId) || this.sessionKey !== sessionKey)
                return;
            const error = nativeOperationError(cause, 'connection-failed', 'The desktop host could not report why playback stopped.');
            this.failNative(sessionId, error.toFailure());
        }
    }
    async retryDeferredStartup(sessionId, sessionKey, cause) {
        const retry = this.startupRetry;
        const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
        if (!retry || retry.retried || retry.completed || !['PIPELINE_FAILED', 'DECODE_FAILED', 'MEDIA_FORMAT_FAILED'].includes(String(code)))
            return false;
        retry.retried = true;
        const current = () => this.isCurrent(sessionId) && this.sessionKey === sessionKey && !this.snapshot.error;
        await this.closeSession(sessionKey).catch(() => undefined);
        if (!current())
            return true;
        try {
            const snapshot = await this.invoker.invoke(`${COMMAND}native_open`, {
                payload: { ...retry.payload, autoplay: this.requestedPlaying, volume: this.volume, muted: this.muted },
            });
            if (!current())
                return true;
            this.acceptSnapshot(snapshot);
            const layout = this.measureLayout();
            await this.invoker.invoke(`${COMMAND}native_layout`, { payload: { sessionKey, ...layout } });
            if (!current())
                return true;
            this.lastLayout = layout;
            this.aperture.publish(layout);
            const startAt = Number(retry.payload.startAtSeconds ?? 0);
            if (startAt > 0 && this.request?.kind !== 'live' && snapshot.backend !== 'mpv') {
                const sought = await this.control('seek', startAt);
                if (!current())
                    return true;
                this.acceptSnapshot(sought);
            }
            if (!current())
                return true;
            if (this.pictureMode === 'fill') {
                const cropped = await this.control('crop');
                if (!current())
                    return true;
                this.acceptSnapshot(cropped);
            }
            if (!current())
                return true;
            this.publishSnapshot(sessionId, this.native);
            return true;
        }
        finally {
            // Rejected IPC can bypass the checks above after the watchdog or Back.
            if (!current())
                await this.closeSession(sessionKey).catch(() => undefined);
        }
    }
    measureLayout() {
        const rect = this.anchor.getBoundingClientRect();
        return {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height)),
        };
    }
    startLayoutTracking() {
        this.stopCompositorObserver = this.aperture.observe((backgroundChanged) => {
            // Never reconstruct DOM from a MutationObserver microtask. Queue one
            // refresh with layout so repeated notifications still yield to input.
            this.compositorDirty ||= backgroundChanged;
            this.requestLayout();
        });
        if (typeof ResizeObserver === 'function') {
            this.resizeObserver = new ResizeObserver(() => this.requestLayout());
            this.resizeObserver.observe(this.anchor);
        }
        window.addEventListener('resize', this.handleViewportChange, { passive: true });
        window.addEventListener('scroll', this.handleViewportChange, { capture: true, passive: true });
        this.requestLayout();
    }
    stopLayoutTracking() {
        this.stopCompositorObserver?.();
        this.stopCompositorObserver = undefined;
        this.resizeObserver?.disconnect();
        this.resizeObserver = undefined;
        window.removeEventListener('resize', this.handleViewportChange);
        window.removeEventListener('scroll', this.handleViewportChange, true);
        if (this.layoutTimer !== undefined) {
            clearTimeout(this.layoutTimer);
            this.layoutTimer = undefined;
        }
        this.layoutDirty = false;
        this.compositorDirty = false;
        this.layoutInFlight = false;
    }
    requestLayout() {
        if (this.sessionKey === undefined)
            return;
        this.layoutDirty = true;
        if (this.layoutTimer !== undefined || this.layoutInFlight)
            return;
        // One frame of batching keeps bursty resize/scroll from crossing IPC; the
        // Rust side serializes native_layout so the host aperture stays aligned.
        this.layoutTimer = setTimeout(() => {
            this.layoutTimer = undefined;
            void this.flushLayout();
        }, 16);
    }
    async flushLayout() {
        const sessionKey = this.sessionKey;
        if (sessionKey === undefined || this.layoutInFlight || !this.layoutDirty)
            return;
        this.layoutInFlight = true;
        try {
            this.layoutDirty = false;
            if (this.compositorDirty) {
                this.compositorDirty = false;
                this.aperture.refresh();
            }
            const layout = this.measureLayout();
            if (!sameLayout(layout, this.lastLayout)) {
                await this.invoker.invoke(`${COMMAND}native_layout`, {
                    payload: { sessionKey, x: layout.x, y: layout.y, width: layout.width, height: layout.height },
                });
            }
            if (this.sessionKey !== sessionKey)
                return;
            this.lastLayout = layout;
            this.aperture.publish(layout);
        }
        catch (cause) {
            const sessionId = this.snapshot.sessionId;
            if (this.isCurrent(sessionId)) {
                const error = nativeOperationError(cause, 'connection-failed', 'The native video surface could not follow its layout.');
                this.failNative(sessionId, error.toFailure());
            }
        }
        finally {
            this.layoutInFlight = false;
            if (this.layoutDirty && this.sessionKey !== undefined)
                this.requestLayout();
        }
    }
    releaseTextureStream() {
        const stream = this.textureStream;
        this.textureStream = undefined;
        for (const track of stream?.getTracks() ?? [])
            track.stop();
        if (stream) {
            try {
                if (this.anchor.srcObject === stream)
                    this.anchor.srcObject = null;
            }
            catch { /* already detached */ }
        }
    }
    watchFirstFrame(sessionId, request) {
        if (request.expectedVideo === false || (this.native?.videoWidth ?? 0) > 0 || this.firstFrameTimer)
            return;
        this.firstFrameTimer = setTimeout(() => {
            this.firstFrameTimer = undefined;
            if (!this.isCurrent(sessionId) || (this.native?.videoWidth ?? 0) > 0 || this.snapshot.state === 'error')
                return;
            this.failNative(sessionId, { code: 'prepare-failed', message: 'The native engine did not produce a video frame before startup timed out.' });
        }, request.startupBudgetMs === undefined ? FIRST_FRAME_TIMEOUT_MS : Math.max(1, Math.min(120_000, request.startupBudgetMs)));
    }
    clearFirstFrameWatchdog() {
        if (this.firstFrameTimer !== undefined) {
            clearTimeout(this.firstFrameTimer);
            this.firstFrameTimer = undefined;
        }
    }
    failNative(sessionId, error) {
        if (!this.isCurrent(sessionId) || this.snapshot.error)
            return;
        this.stopPolling();
        this.clearFirstFrameWatchdog();
        this.stopLayoutTracking();
        this.fail(sessionId, error);
    }
    async closeSession(sessionKey) {
        await this.invoker
            .invoke(`${COMMAND}native_close`, { payload: { sessionKey } })
            .catch(() => undefined);
    }
    async teardownNative() {
        this.stopPolling();
        this.clearFirstFrameWatchdog();
        this.stopLayoutTracking();
        this.aperture.close();
        this.releaseTextureStream();
        const sessionKey = this.sessionKey;
        this.sessionKey = undefined;
        this.native = undefined;
        this.pendingSeek = undefined;
        this.request = undefined;
        this.requestedPlaying = false;
        this.lastLayout = undefined;
        if (sessionKey !== undefined)
            await this.closeSession(sessionKey);
    }
}

/** Physical Conjure evidence, 2026-09-27. Firmware/engine changes invalidate it.
 * H.264: 1080p30/60; HEVC Main/Main10: 2160p24 SDR. No HDR claim.
 * See the media qualification report; frame callbacks are not usable on this firmware.
 */
function qualifiedVizioEvidence(userAgent, mseTypeSupported) {
    if (!userAgent.includes('Model/V655-G9') || !userAgent.includes('FW/2.600.596.0-10') || !userAgent.includes('Conjure/MTKB-7.600.259.0-prod'))
        return [];
    const entries = [];
    if (mseTypeSupported('video/mp4; codecs="avc1.64002a"'))
        entries.push({ engine: 'mse', codec: 'avc', profile: 'High', maxLevel: 42, containers: ['mp4', 'cmaf'], evidence: 'decoded', maxWidth: 1920, maxHeight: 1080, maxFrameRate: 60, bitDepth: 8, hdr: false });
    if (mseTypeSupported('video/mp4; codecs="hvc1.1.6.L150.B0"'))
        entries.push({ engine: 'mse', codec: 'hevc', profile: 'Main', maxLevel: 150, containers: ['mp4', 'cmaf'], evidence: 'decoded', maxWidth: 3840, maxHeight: 2160, maxFrameRate: 24, bitDepth: 8, hdr: false });
    if (mseTypeSupported('video/mp4; codecs="hvc1.2.4.L150.B0"'))
        entries.push({ engine: 'mse', codec: 'hevc', profile: 'Main 10', maxLevel: 150, containers: ['mp4', 'cmaf'], evidence: 'decoded', maxWidth: 3840, maxHeight: 2160, maxFrameRate: 24, bitDepth: 10, hdr: false });
    return entries;
}

const BROWSER_CODECS = {
    h264: 'video/mp4; codecs="avc1.640029"',
    hevc: 'video/mp4; codecs="hvc1.1.6.L150.B0"',
    aac: 'audio/mp4; codecs="mp4a.40.2"',
};
/** Probe each executable decoding path separately; actual track preparation remains authoritative. */
async function probeBrowserPlaybackCapabilities(environment, options = {}) {
    const source = typeof MediaSource === 'undefined' ? undefined : MediaSource;
    const env = environment ?? {
        media: document.createElement('video'),
        decodingInfo: navigator.mediaCapabilities?.decodingInfo.bind(navigator.mediaCapabilities),
        mseSupported: Hls.isSupported(),
        mseTypeSupported: (type) => source?.isTypeSupported(type) ?? false,
    };
    const evidence = [];
    const bunny = !environment && options.mediabunny ? await probeWebCodecs() : { h264: false, hevc: false, aac: false };
    const bunnyBaseline = bunny.h264 && bunny.aac;
    if (!environment && options.mediabunny)
        evidence.push(`mediabunny:webcodecs:h264=${bunny.h264};hevc=${bunny.hevc};aac=${bunny.aac}`);
    const nativeHls = supportsNativeHls(env.media);
    const mseHls = !nativeHls && env.mseSupported;
    const selectedHls = bunnyBaseline ? 'mediabunny' : nativeHls ? 'native' : mseHls ? 'mse' : 'unsupported';
    async function codec(name, path) {
        const mime = BROWSER_CODECS[name];
        let hint = false;
        try {
            hint = path === 'file' ? !!env.media.canPlayType(mime) : env.mseTypeSupported(mime);
        }
        catch { /* unsupported API */ }
        if (!hint) {
            evidence.push(`${path}:${name}:mime-unsupported`);
            return false;
        }
        if (!env.decodingInfo) {
            evidence.push(`${path}:${name}:mime-supported; decodingInfo-unavailable`);
            return true;
        }
        const configuration = name === 'aac'
            ? { type: path, audio: { contentType: mime, channels: '2', bitrate: 192000, samplerate: 48000 } }
            : { type: path, video: { contentType: mime, width: 1920, height: 1080, bitrate: 8000000, framerate: 30 } };
        // One bounded probe per configuration; null means the timeout won the race.
        const probe = async (candidate) => {
            let timer;
            try {
                return await Promise.race([
                    Promise.resolve().then(() => env.decodingInfo(candidate)),
                    new Promise((resolve) => { timer = setTimeout(() => resolve(null), env.timeoutMs ?? 1000); }),
                ]);
            }
            finally {
                clearTimeout(timer);
            }
        };
        try {
            const result = await probe(configuration);
            if (result !== null && !result.supported && name !== 'aac') {
                // decodingInfo refuses the 1080p probe sample on hardware that still
                // decodes smaller frames, so video codecs re-probe at 720p before
                // reporting the browser incompatible; audio has no geometry to drop.
                const fallback = await probe({ type: path, video: { contentType: mime, width: 1280, height: 720, bitrate: 4000000, framerate: 30 } });
                evidence.push(`${path}:${name}:decodingInfo-unsupported-1080p; ${fallback === null ? 'decodingInfo-timeout-720p; mime-supported' : `${fallback.supported ? 'supported' : 'unsupported'}-720p`}`);
                return fallback === null ? hint : fallback.supported;
            }
            evidence.push(`${path}:${name}:${result === null ? 'decodingInfo-timeout; mime-supported' : `decodingInfo-${result.supported ? 'supported' : 'unsupported'}; smooth=${result.smooth}; powerEfficient=${result.powerEfficient}`}`);
            return result === null ? hint : result.supported;
        }
        catch {
            evidence.push(`${path}:${name}:decodingInfo-unavailable; mime-supported`);
            return hint;
        }
    }
    const [nativeH264, nativeHevc, nativeAac, mseH264, mseHevc, mseAac] = await Promise.all([
        codec('h264', 'file'), codec('hevc', 'file'), codec('aac', 'file'),
        mseHls ? codec('h264', 'media-source') : false,
        mseHls ? codec('hevc', 'media-source') : false,
        mseHls ? codec('aac', 'media-source') : false,
    ]);
    const h264 = bunnyBaseline || (nativeHls ? nativeH264 : mseHls && mseH264);
    const aac = bunnyBaseline || (nativeHls ? nativeAac : mseHls && mseAac);
    const hevc = (bunny.hevc && bunny.aac) || (nativeHevc && (nativeHls || (mseHls && mseHevc)));
    const directMp4 = bunnyBaseline || (nativeH264 && nativeAac);
    const canPlayManagedHls = h264 && aac;
    const policy = browserPlaybackPolicy();
    const qualified = !environment && (policy.clientInspection || policy.localRemux) ? qualifiedVizioEvidence(navigator.userAgent, env.mseTypeSupported) : [];
    const browser = policy.clientInspection || policy.localRemux ? {
        version: 1, inspectOriginal: policy.clientInspection, localRemux: policy.localRemux,
        fmp4: env.mseSupported && env.mseTypeSupported(BROWSER_CODECS.h264),
        engines: [
            ...qualified,
            ...[['avc', nativeH264], ['hevc', nativeHevc], ['aac', nativeAac]].map(([codec, supported]) => ({ engine: 'native', codec, evidence: supported ? 'advertised' : 'unknown', ...(codec === 'aac' ? { profile: 'LC', maxChannels: 2, sampleRates: [48000] } : { profile: codec === 'hevc' ? 'Main' : 'High', maxLevel: codec === 'hevc' ? 150 : 41, maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30, bitDepth: 8, hdr: false }), containers: ['mp4', 'hls'] })),
            ...[['avc', mseH264], ['hevc', mseHevc], ['aac', mseAac]].map(([codec, supported]) => ({ engine: 'mse', codec, evidence: supported ? 'advertised' : 'unknown', ...(codec === 'aac' ? { profile: 'LC', maxChannels: 2, sampleRates: [48000] } : { profile: codec === 'hevc' ? 'Main' : 'High', maxLevel: codec === 'hevc' ? 150 : 41, maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30, bitDepth: 8, hdr: false }), containers: ['mp4', 'cmaf'] })),
            ...[['avc', bunny.h264], ['hevc', bunny.hevc], ['aac', bunny.aac]].map(([codec, supported]) => ({ engine: 'webcodecs', codec, evidence: supported ? 'advertised' : 'unknown', ...(codec === 'aac' ? { profile: 'LC', maxChannels: 2, sampleRates: [48000] } : { profile: codec === 'hevc' ? 'Main' : 'High', maxLevel: codec === 'hevc' ? 150 : 41, maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30, bitDepth: 8, hdr: false }), containers: ['mp4', 'mov', 'mkv', 'webm', 'mpegts', 'hls'] })),
        ],
    } : undefined;
    // A WebCodecs demuxer can read the original container (Matroska, MPEG-TS, the
    // ISO base media formats and more) instead of a server-remuxed HLS window, so
    // report that file path and the codecs it can decode.
    const { decodableCodecs } = bunnyBaseline && !environment && options.mediabunny
        ? await import('./mediabunny-DAw0uoDL.js')
        : { decodableCodecs: undefined };
    const fileCodecs = decodableCodecs ? await decodableCodecs() : undefined;
    if (fileCodecs)
        evidence.push(`files:video=${fileCodecs.video.join('|')};audio=${fileCodecs.audio.join('|')}`);
    evidence.push(`hls:${selectedHls}`, 'sample:1080p30; h264-high-4.1; hevc-main-5.0-sdr; aac-lc-stereo');
    return {
        capabilities: {
            ...(browser ? { browser } : {}),
            maxWidth: fileCodecs || qualified.some(e => e.maxWidth === 3840) ? 3840 : 1920, maxHeight: fileCodecs || qualified.some(e => e.maxHeight === 2160) ? 2160 : 1080,
            h264, hevc, aac, directPlay: directMp4 || canPlayManagedHls || !!browser?.inspectOriginal, hevcSdr: hevc, directMp4, directHls: canPlayManagedHls,
            directFiles: !!fileCodecs, directVideoCodecs: fileCodecs?.video, directAudioCodecs: fileCodecs?.audio,
        },
        canPlayManagedHls,
        protocols: { nativeHls, mseHls, selectedHls }, evidence,
    };
}
/** Only used by the browser adapter that actually consumes WebCodecs via Mediabunny. */
async function probeWebCodecs() {
    if (!globalThis.isSecureContext || typeof VideoDecoder === 'undefined' || typeof AudioDecoder === 'undefined' || typeof AudioContext === 'undefined')
        return { h264: false, hevc: false, aac: false };
    const bounded = async (probe) => {
        let timer;
        try {
            return await Promise.race([Promise.resolve().then(probe).then(result => result.supported === true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 1000); })]);
        }
        catch {
            return false;
        }
        finally {
            clearTimeout(timer);
        }
    };
    const [h264, hevc, aac] = await Promise.all([
        bounded(() => VideoDecoder.isConfigSupported({ codec: 'avc1.640029', codedWidth: 1920, codedHeight: 1080 })),
        bounded(() => VideoDecoder.isConfigSupported({ codec: 'hvc1.1.6.L150.B0', codedWidth: 1920, codedHeight: 1080 })),
        bounded(() => AudioDecoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 })),
    ]);
    return { h264, hevc, aac };
}

/**
 * Delivery capability profiles for each platform entry point
 * (design ADR 0003, platform matrix).
 *
 * These are the profiles the server consults while choosing a rung of its
 * delivery ladder: direct native file, original container for a client that
 * demuxes itself, or managed conversion. They are deliberately separate from
 * the engine `PlayerCapabilities` records the adapters declare. TV engines
 * and the desktop host are qualified by their own runtime — a desktop
 * browser decoder probe must never gate their delivery — and only the web
 * entry point is measured.
 */
/**
 * Samsung AVPlay: native H.264/HEVC/AAC decode up to 1080p. Direct play takes
 * the native envelope (H.264 copy, HEVC Main/SDR); whatever the envelope
 * refuses falls to managed conversion. The original-container rung is a
 * WebCodecs client contract and stays off.
 */
const TIZEN_DELIVERY_CAPABILITIES = {
    maxWidth: 1920,
    maxHeight: 1080,
    h264: true,
    hevc: true,
    aac: true,
    directPlay: true,
    hevcSdr: true,
};
/**
 * Vizio SmartCast cast receiver: the receiver is the tv-web bundle running in
 * the TV's HTML engine — native HLS, then hls.js/MSE — with no WebCodecs
 * path. It claims only the measured baseline (H.264/AAC at 1080p): HEVC stays
 * unclaimed rather than assumed, the original-container rung stays off, and
 * every source this envelope refuses is served through the managed ladder
 * (copy/remux, then conversion only as necessary).
 */
const VIZIO_DELIVERY_CAPABILITIES = {
    maxWidth: 1920,
    maxHeight: 1080,
    h264: true,
    hevc: false,
    aac: true,
    directPlay: true,
    hevcSdr: false,
};
// The desktop profile stays declared with its adapter in `tauri-native.ts`
// (direct-play only, original container allowed); it is imported here so this
// module is the single place every delivery profile is reachable from.
let webReport;
/**
 * Web browser entry: the one platform whose delivery profile is measured
 * rather than declared. The probe reports the browser's real decoder
 * envelope, including the separate direct MP4/HLS fields and the WebCodecs
 * codec lists that gate the original-container rung. A browser that cannot
 * play managed HLS cannot use the supported streaming output at all, so the
 * gate rejects loudly. A successful probe is memoized; a failed one is
 * retried on the next session start.
 */
function webDeliveryCapabilities() {
    const report = (webReport ??= probeBrowserPlaybackCapabilities(undefined, { mediabunny: true }).catch((cause) => {
        webReport = undefined;
        throw cause;
    }));
    return report.then((probe) => {
        if (!probe.canPlayManagedHls && !probe.capabilities.browser?.inspectOriginal) {
            throw new Error('This browser cannot play the supported H.264/AAC streaming output. Use a supported browser or TV player.');
        }
        return probe.capabilities;
    });
}
/**
 * Canonical per-platform dispatch for the tv-web entry point. Tizen, Vizio
 * and the Tauri desktop host resolve their declared profiles without ever
 * consulting a browser decoder probe; only `html5` is measured.
 */
function deliveryCapabilitiesFor(platform) {
    switch (platform) {
        case 'tizen':
            return async () => TIZEN_DELIVERY_CAPABILITIES;
        case 'vizio':
            return async () => browserPlaybackPolicy().clientInspection || browserPlaybackPolicy().localRemux
                ? (await probeBrowserPlaybackCapabilities(undefined, { mediabunny: false })).capabilities
                : VIZIO_DELIVERY_CAPABILITIES;
        case 'tauri':
            return async () => TAURI_NATIVE_DELIVERY_CAPABILITIES;
        case 'html5':
            return webDeliveryCapabilities;
    }
}

const MAX_CUES = 4096;
const MAX_ACTIVE = 32;
const MAX_VISITS = 128;
const MAX_SWAP_WAIT_SECONDS = 5;
const validIdentity = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u0020\u007f]/.test(value);
class SubtitleSyncView {
    constructor(cues, generation, subtitleHash) {
        this.generation = generation;
        this.subtitleHash = subtitleHash;
        this.seenRevision = 0;
        this.manualSeconds = 0;
        this.frozen = false;
        this.disposed = false;
        if (cues.length > MAX_CUES || cues.some(c => !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.end <= c.start || c.text.length > 4096) || cues.some((c, i) => i > 0 && c.start < cues[i - 1].start))
            throw new Error('Subtitle window exceeds its supported bounds.');
        this.cues = cues.map(c => ({ ...c }));
        let end = -Infinity;
        this.prefixEnd = this.cues.map(c => end = Math.max(end, c.end));
    }
    accept(record) {
        if (this.disposed || record.version !== 1 || record.playback_generation !== this.generation || record.subtitle_hash !== this.subtitleHash || record.algorithm_version !== 'activity-offset-affine-v1' || !Number.isSafeInteger(record.revision) || record.revision <= this.seenRevision)
            return false;
        if (!validIdentity(record.media_identity) || !validIdentity(record.audio_identity) || typeof record.manual !== 'boolean' || !['observing', 'accepted', 'ambiguous', 'unavailable'].includes(record.state))
            return false;
        if (this.identity && (this.identity.media !== record.media_identity || this.identity.audio !== record.audio_identity))
            return false;
        const c = record.correction;
        if (c !== null && (!c || typeof c !== 'object' || !Number.isSafeInteger(c.anchorUs) || !Number.isSafeInteger(c.offsetUs) || Math.abs(c.offsetUs) > 30_000_000 || !Number.isFinite(c.scale) || c.scale < 0.98 || c.scale > 1.02))
            return false;
        if (record.state === 'accepted' && c === null)
            return false;
        this.seenRevision = record.revision;
        this.identity = { media: record.media_identity, audio: record.audio_identity };
        if (record.manual) {
            this.frozen = true;
            this.pending = undefined;
            this.pendingAtSeconds = undefined;
        }
        if (this.frozen || record.state !== 'accepted' || !c)
            return false;
        if (!this.pending)
            this.pendingAtSeconds = this.lastTitleSeconds;
        this.pending = { ...record, correction: { ...c } };
        return true;
    }
    manualDelay(seconds) {
        if (!Number.isFinite(seconds) || Math.abs(seconds) > 120)
            throw new Error('Invalid subtitle delay.');
        this.manualSeconds = seconds;
        this.frozen = true;
        this.pending = undefined;
        this.pendingAtSeconds = undefined;
    }
    resume() { this.frozen = false; }
    at(playerSeconds, originSeconds) {
        const titleSeconds = playerSeconds + originSeconds;
        if (this.disposed || !Number.isFinite(playerSeconds) || !Number.isFinite(originSeconds) || !Number.isFinite(titleSeconds))
            return { texts: [], deferred: true };
        let result = this.lookup(this.subtitleTime(titleSeconds));
        if (this.pending) {
            if (this.pendingAtSeconds === undefined || (this.lastTitleSeconds !== undefined && titleSeconds < this.lastTitleSeconds))
                this.pendingAtSeconds = titleSeconds;
            if ((!result.deferred && result.texts.length === 0) || titleSeconds - this.pendingAtSeconds >= MAX_SWAP_WAIT_SECONDS) {
                this.record = this.pending;
                this.pending = undefined;
                this.pendingAtSeconds = undefined;
                result = this.lookup(this.subtitleTime(titleSeconds));
            }
        }
        this.lastTitleSeconds = titleSeconds;
        return result;
    }
    subtitleTime(titleSeconds) {
        const c = this.record?.correction;
        return c ? c.anchorUs / 1e6 + (titleSeconds - c.anchorUs / 1e6 - c.offsetUs / 1e6 - this.manualSeconds) / c.scale : titleSeconds - this.manualSeconds;
    }
    lookup(time) {
        let lo = 0, hi = this.cues.length;
        while (lo < hi) {
            const middle = (lo + hi) >>> 1;
            if (this.cues[middle].start <= time)
                lo = middle + 1;
            else
                hi = middle;
        }
        const texts = [];
        let visits = 0;
        for (let index = lo - 1; index >= 0 && this.prefixEnd[index] > time; index--) {
            if (++visits > MAX_VISITS)
                return { texts: [], deferred: true };
            const cue = this.cues[index];
            if (time < cue.end) {
                texts.push(cue.text);
                if (texts.length > MAX_ACTIVE)
                    return { texts: [], deferred: true };
            }
        }
        return { texts: texts.reverse(), deferred: false };
    }
    dispose() { this.disposed = true; this.pending = undefined; this.pendingAtSeconds = undefined; }
}

/** One factory keeps the React UI independent of the TV's playback engine. */
function createPlayer(options) {
    switch (options.platform) {
        case 'tizen':
            return new TizenAvplayAdapter(options.avplay);
        case 'vizio':
            return browserPlaybackPolicy().localRemux
                ? new Html5FallbackAdapter(requireVideo(options.video), undefined, 'vizio')
                : new VizioHtml5Adapter(requireVideo(options.video));
        case 'html5':
            return new Html5FallbackAdapter(requireVideo(options.video), options.canvas);
        case 'tauri': {
            const anchor = requireVideo(options.video);
            if (!(anchor instanceof HTMLVideoElement)) {
                throw new Error('A video element is required for native Tauri playback.');
            }
            // The default invoker rejects outside the Tauri runtime, so a browser
            // that somehow requests this platform fails honestly at construction.
            return new TauriNativeAdapter(anchor, resolveTauriVideoInvoker(), { engine: options.engine });
        }
    }
}
function requireVideo(video) {
    if (!video)
        throw new Error('A video element is required for HTML playback.');
    return video;
}

export { AdaptiveQuality as A, deliveryCapabilitiesFor as B, isTauriRuntime as C, parseWebVtt as D, EMPTY_TRACKS as E, probeBrowserPlaybackCapabilities as F, resolveTauriVideoInvoker as G, Html5FallbackAdapter as H, IDLE_SNAPSHOT as I, supportsNativeHls as J, webDeliveryCapabilities as K, PlayerOperationError as P, SessionPlayer as S, TAURI_NATIVE_DELIVERY_CAPABILITIES as T, VIZIO_DELIVERY_CAPABILITIES as V, sessionMediaFetch as a, audioChoices as b, chooseAudio as c, canChangeMediaPath as d, timelineDuration as e, delay as f, growOnlyDuration as g, hasSourceAuthorization as h, PlaybackSessionController as i, SubtitleSyncView as j, TAURI_NATIVE_PLAYER_CAPABILITIES as k, TAURI_VIDEO_PROTOCOL_VERSION as l, mediaFailure as m, TIZEN_AVPLAY_CAPABILITIES as n, TIZEN_DELIVERY_CAPABILITIES as o, TauriNativeAdapter as p, TizenAvplayAdapter as q, VIZIO_HTML5_CAPABILITIES as r, sessionMediaRetryDelay as s, trackId as t, VizioHtml5Adapter as u, videoChoices as v, boundedPosition as w, browserPlaybackPolicy as x, configureBrowserPlayback as y, createPlayer as z };
//# sourceMappingURL=index-CH96rjHH.js.map
