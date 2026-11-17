// src/Renderer.ts
import { normalizeBoundsMargin, } from './common/types.js';
import { RendererCore } from './core/RendererCore.js';
import { GlBackend } from './core/gl/GlBackend.js';
import { FrameLoop } from './core/loop.js';
import { FrameSnapper } from './core/animation/FrameSnapper.js';
import { Loader } from './core/textures/Loader.js';
import { Uploader } from './core/textures/Uploader.js';
import { MemoryManager } from './core/textures/MemoryManager.js';
import { AtlasPages, PAGE_SIZE } from './core/textures/AtlasPages.js';
import { DIRTY_INHERITED } from './core/nodes/NodeFlags.js';
import { ENABLE_INSPECTOR } from './common/flags.js';
import { Telemetry } from './core/telemetry.js';
import { getDefaultPlatform } from './platform/Platform.js';
import { WebPlatform } from './platform/WebPlatform.js';
import { APPLY_ANIMATION_SNAP, APPLY_BOUNDS_MARGIN, APPLY_CLEAR_COLOR, APPLY_INSPECTOR, APPLY_INSPECTOR_OPTIONS, APPLY_TARGET_FPS, APPLY_TELEMETRY, APPLY_TEXTURE_MEMORY, resolveSettings, runtimeSettings, } from './settings.js';
const hasOwn = Object.prototype.hasOwnProperty;
/** Frame period in ms for a cap in frames per second (0: uncapped). */
const frameTime = (fps) => (fps > 0 ? 1000 / fps : 0);
/**
 * What a listener threw, to handleLoopError (FrameEvents.onError). A
 * handler that rethrows (log and rethrow) gets the error raised again from
 * a timer of its own: thrown inside the flush, it would leave the rest of
 * the batch queued with nothing to deliver it, escape a timer flush, and
 * reach handleLoopError a second time through the frame's error path. The
 * try/catch keeps to this small shell, outside the delivery loop.
 */
function reportListenerError(handleLoopError, platform, error) {
    try {
        handleLoopError(error);
    }
    catch (rethrown) {
        platform.setTimeout(() => {
            throw rethrown;
        }, 0);
    }
}
/**
 * The renderer (spec 12.2), also exported as `RendererMain`: RendererCore
 * plus the canvas, the GL backend, the frame loop and the settings table.
 * Events: `idle` (the loop went idle), `frameTick` ({ time, delta } at the
 * start of every frame the loop runs, drawn or not), `contextLost`, the
 * telemetry's `fpsUpdate` and `renderUpdate` (while `fpsUpdateInterval` is
 * above 0), and the memory events `criticalCleanup`,
 * `criticalCleanupFailed` and `outOfMemory`.
 *
 * `idle` fires synchronously inside the animation-frame callback that drew
 * the last frame (1.10 fired it one vsync later, in a tick that drew
 * nothing), so heavy work in an `idle` listener delays that frame reaching
 * the screen.
 */
export class Renderer extends RendererCore {
    constructor(settings = {}, target) {
        // The platform comes first: a host platform may adjust the settings
        // before any default applies. The app's choice wins over the host's
        // registered default; the web platform stands in for neither.
        const Host = settings.platform ?? getDefaultPlatform();
        const platform = Host !== null ? new Host() : new WebPlatform();
        const input = platform.resolveSettings(settings);
        const canvas = input.canvas ?? platform.createCanvas();
        const s = resolveSettings(input, canvas);
        super(s);
        /** Turns frame deltas into animation steps (animationSnapRate). */
        this.snapper = new FrameSnapper();
        /** destroy() ran: a frame still in progress must not touch the backend. */
        this.destroyed = false;
        /**
         * A decode landed, or a run left uploads over: the next frame runs the
         * uploader, with no walk or draw unless something else asks for one (the
         * upload marks the nodes showing the texture, which draw it the frame
         * after).
         */
        this.uploadRequested = false;
        /** Frame telemetry, while fpsUpdateInterval is above 0; null otherwise. */
        this.telemetry = null;
        /** The telemetry label (setTelemetrySegment), kept while it is off. */
        this.segment = '';
        /** The DOM inspector, when the settings name one (and the build allows it). */
        this.inspector = null;
        this.settings = s;
        this.platform = platform;
        this.canvas = canvas;
        this.ownsCanvas = canvas !== input.canvas;
        const logicalW = s.appWidth * s.deviceLogicalPixelRatio;
        const logicalH = s.appHeight * s.deviceLogicalPixelRatio;
        platform.sizeCanvas(canvas, logicalW * s.devicePhysicalPixelRatio, logicalH * s.devicePhysicalPixelRatio, logicalW, logicalH);
        // Scissor boxes flip against the canvas's own height, which truncates
        // a fractional size (1.10 Stage.canvasH).
        this.view.canvasH = canvas.height;
        const backend = new GlBackend(canvas, {
            forceWebGL2: s.forceWebGL2,
            disableVertexArrayObject: s.disableVertexArrayObject,
            powerPreference: s.powerPreference,
            enableContextSpy: s.enableContextSpy,
            clearColor: s.clearColor,
            pixelRatio: this.view.pixelRatio,
            quadBufferSize: s.quadBufferSize,
        });
        this.backend = backend;
        this.startTime = platform.now();
        // Shader programs compile in the backend, bound to the node store for
        // their per-op uniforms and to their type's time value.
        const nodes = this.nodes;
        const shaders = this.shaders;
        shaders.host = {
            viewport: backend.viewport,
            register: (vertex, fragment, extensions, table, time, name) => {
                const id = backend.registerProgram(vertex, fragment, extensions, name);
                const program = backend.programs[id];
                program.table = table;
                program.bindSystem(nodes, time);
                return id;
            },
            systemMask: (program) => backend.programs[program].systemMask,
            isLost: () => backend.ctx.isLost(),
        };
        // A compile that found the context lost: reported as the browser's
        // event is, outside the frame (the handler below is latched, so the
        // event itself, when it comes, is not reported again).
        shaders.onLost = () => {
            platform.setTimeout(() => {
                const onContextLost = backend.onContextLost;
                if (this.destroyed === false && onContextLost !== null) {
                    onContextLost();
                }
            }, 0);
        };
        // A shader time function (app code) that threw while drawing: a loop
        // error, reported after the draw (reportErrors below).
        shaders.onError = (error) => {
            reportListenerError(s.handleLoopError, platform, error);
        };
        this.onFlush = (stream, ops) => {
            backend.draw(stream, ops, this.clips);
        };
        const textures = this.textures;
        textures.maxRetries = s.maxRetryCount;
        textures.now = () => platform.now();
        textures.sink = backend;
        // A decode needs a frame for its upload, not a walk and a draw: the
        // upload marks the nodes showing the texture (roadmap 4.2), so an image
        // arriving while idle draws once, after its upload. So do uploads a run
        // left over: what went up marked its nodes already, and a texture held
        // back forces no walk and draw.
        const uploadFrame = () => {
            this.uploadRequested = true;
            this.onFrameRequest();
        };
        textures.requestFrame = uploadFrame;
        const memory = new MemoryManager(textures, this.events, this, s.textureMemory);
        this.memory = memory;
        memory.schedule = (callback, ms) => {
            platform.setTimeout(callback, ms);
        };
        memory.requestFrame = () => {
            this.requestRender();
        };
        this.loader = new Loader(platform, this.textures, {
            numImageWorkers: s.numImageWorkers,
            imageDecodeConcurrency: s.imageDecodeConcurrency,
            createImageBitmapSupport: s.createImageBitmapSupport,
            premultiplyAlphaHonored: s.premultiplyAlphaHonored,
            pixelRatio: this.view.pixelRatio,
        });
        this.textures.schedule = (callback, ms) => {
            platform.setTimeout(callback, ms);
        };
        this.textures.onQueued = () => {
            this.loader.dispatch();
        };
        let atlas = null;
        if (s.imageAtlas === true) {
            const max = backend.maxTextureSize;
            atlas = new AtlasPages(textures, backend, max > 0 && max < PAGE_SIZE ? max : PAGE_SIZE);
            memory.atlas = atlas;
        }
        this.uploader = new Uploader(textures, backend, () => platform.now(), uploadFrame, memory, atlas);
        // adaptiveDuration measures real time: the frame clock stands still
        // while the loop sleeps.
        this.animationManager.clock = () => platform.now();
        // An event queued outside a frame (a retry timer, idle maintenance) is
        // delivered by a timer of its own, not by a walk and a draw.
        this.events.schedule = (callback) => {
            platform.setTimeout(callback, 0);
        };
        // A listener's error goes to handleLoopError, whether a frame or a
        // timer delivered the event, and the flush goes on. So does a text
        // `loaded` listener's, delivered between the frame's walks.
        this.events.onError = (error) => {
            reportListenerError(s.handleLoopError, platform, error);
        };
        this.textEvents.onError = (error) => {
            reportListenerError(s.handleLoopError, platform, error);
        };
        // Fonts load through the platform: the atlas description by its fetch
        // (a failure retried on its timers), the atlas as any image.
        this.fonts.fetch = (url, type) => platform.fetch(url, type);
        this.fonts.schedule = (callback, ms) => {
            platform.setTimeout(callback, ms);
        };
        const loop = new FrameLoop(platform, {
            needsFrame: () => this.frameRequested === true ||
                this.animationManager.hasActive === true ||
                this.uploadRequested === true,
            animating: () => this.animationManager.hasActive,
            frame: (time, dt, nominal) => {
                this.frame(time, dt, nominal);
            },
            idle: () => {
                // The next frame is a wake: it starts a new cadence.
                this.snapper.reset();
                const telemetry = this.telemetry;
                if (telemetry !== null) {
                    telemetry.idle(this.currentFrameTime);
                }
                // Some hosts (Xumo's WPE) show a frame drawn in a wake from idle
                // only once the page repaints: ask for one now that drawing has
                // stopped. Before the event, whose listener may destroy the renderer.
                if (s.presentOnIdle === true) {
                    platform.present(canvas);
                }
                this.emit('idle');
            },
            paused: () => {
                this.snapper.reset();
                // Asleep, the telemetry would go on closing samples on its timer:
                // nothing is sampled until resume() (1.10).
                const telemetry = this.telemetry;
                if (telemetry !== null) {
                    telemetry.halt();
                }
            },
            maintain: () => {
                this.maintain();
            },
            error: (error) => {
                // The frame that threw never reached its flush: events must not stay
                // held, or none queued later would schedule a flush of its own.
                this.events.holding = false;
                s.handleLoopError(error);
            },
        });
        loop.targetFrameTime = frameTime(s.targetFPS);
        this.snapper.period = frameTime(s.animationSnapRate);
        loop.wakeFallbackDelay = s.wakeFallbackDelay;
        this.loop = loop;
        // No restore: the context is gone for good and the app reloads (1.10).
        backend.onContextLost = () => {
            // Latched: an app that calls preventDefault() on webglcontextlost lets
            // the browser restore the context, and a second loss would emit again.
            backend.onContextLost = null;
            loop.stop();
            // No frame comes again: telemetry would close an empty sample every
            // interval, for good (1.10 sampled nothing after a loss).
            const telemetry = this.telemetry;
            if (telemetry !== null) {
                telemetry.stop();
                this.telemetry = null;
            }
            this.emit('contextLost');
        };
        // A null or empty target is no target (1.10 tested `if (target)`).
        if (target !== undefined && target !== null && target !== '') {
            const element = typeof target === 'string' ? platform.getElementById(target) : target;
            if (element === null) {
                throw new Error('Could not find target element');
            }
            element.appendChild(canvas);
        }
        else if (this.ownsCanvas === true) {
            throw new Error('New canvas element could not be appended to undefined target');
        }
        // Last, once nothing above can throw: an inspector lays its overlay in
        // the page and an attached telemetry arms a timer, either of which would
        // outlive a renderer that failed to construct. The inspector first: its
        // constructor can throw (a page without a body yet), the telemetry's
        // cannot.
        if (ENABLE_INSPECTOR === true) {
            this.applyInspector(false);
        }
        this.applyTelemetry();
        // The root's creation requested a frame before the loop existed.
        loop.schedule();
        // The idle warm-up (spec 8.1): the renderer waits between booting and
        // the app's first data, so the programs a first screen compiles on
        // first use compile then, not in its frames. One a timer tick, the
        // first after the app's startup code has registered its shader types:
        // a response or a frame that comes in between waits for one compile,
        // not for all of them.
        const warm = () => {
            if (this.destroyed === true || backend.ctx.isLost() === true) {
                return;
            }
            if (this.warmNext() === true) {
                platform.setTimeout(warm, 0);
            }
        };
        platform.setTimeout(warm, 0);
    }
    /** The frame-request funnel (RendererCore): every request schedules a frame. */
    onFrameRequest() {
        const loop = this.loop;
        // Undefined only while RendererCore's constructor creates the root.
        if (loop !== undefined) {
            loop.schedule();
        }
    }
    /** One frame (the loop calls it): animations, the scene walk, the draw. */
    frame(time, dt, nominal) {
        this.animationManager.now = time;
        this.animationManager.maxFirstStep = nominal;
        // The clock shader time functions read (1.10's Stage timing values).
        this.lastFrameTime = this.currentFrameTime;
        this.currentFrameTime = time;
        this.deltaTime = dt;
        this.elapsedTime = time - this.startTime;
        if (this.hasListener('frameTick') === true) {
            this.emit('frameTick', { time, delta: dt });
        }
        // A frameTick listener may have called destroy(): the loop is stopped
        // and the context released, so nothing below may run (animations would
        // step a destroyed scene, and destroying the root raised frameRequested
        // again, which would walk and draw).
        if (this.destroyed === true) {
            return;
        }
        // Read before the step: the frame an animation ends on still counts as
        // animated for the upload budget and the telemetry (1.10).
        const animating = this.animationManager.hasActive;
        this.step(this.snapper.step(dt));
        const events = this.events;
        // One read per frame: a frame is measured throughout or not at all, and
        // one a listener turned the telemetry off or on in is not ticked.
        const telemetry = this.telemetry;
        const platform = this.platform;
        // Every draw source raises frameRequested (a store write, requestRender,
        // reprocessUpdates). Without it nothing changed, as in an animation's
        // delay or a frame a decode asked for: no walk, no draw, and the last
        // frame stays on screen (1.10). Decoded textures still go up: a large
        // one the animation holds back counts this frame toward its wait
        // without a draw of its own (an upload marks its nodes, and they draw
        // it next frame). While critical, the cleanup follows these uploads as
        // it follows a drawn frame's: one that crossed the threshold here is
        // not left for the next drawn frame.
        if (this.frameRequested === false) {
            this.uploadRequested = false;
            events.holding = true;
            if (this.textures.decodedCount > 0) {
                // Timed from here (a drawn frame's from the end of its draw).
                const start = telemetry !== null ? platform.now() : 0;
                this.upload(animating, telemetry, start);
                if (this.memory.criticalCleanupRequested === true) {
                    this.memory.cleanupAt(time);
                }
            }
            if (telemetry !== null && telemetry === this.telemetry) {
                telemetry.tick(time, dt, false, animating);
            }
            events.holding = false;
            events.flush();
            return;
        }
        const backend = this.backend;
        backend.beginFrame();
        // A drawn frame ends an idle period (the memory manager's put-off idle
        // check reads the count); records created in this frame are stamped
        // with its time.
        const textures = this.textures;
        textures.frame++;
        textures.time = time;
        // Events the frame raises wait for its flush, after the draw.
        events.holding = true;
        let updateStart = 0;
        if (telemetry !== null) {
            updateStart = platform.now();
        }
        this.update();
        // A reprocessUpdates callback (or an event the walk raised) may have
        // called destroy() too, and so may an animation callback in step()
        // above: the context is gone, so there is nothing to draw into. The
        // cast keeps TypeScript's narrowing from the guard at the top of this
        // function from flagging the comparison as impossible.
        if (this.destroyed === true) {
            events.holding = false;
            return;
        }
        let drawStart = 0;
        if (telemetry !== null) {
            drawStart = platform.now();
        }
        backend.draw(this.stream, this.ops, this.clips);
        // A shader time function (app code, run inside the draw) may have
        // called destroy(): nothing below may run on a destroyed renderer.
        if (this.destroyed === true) {
            events.holding = false;
            return;
        }
        // A drawn op of a timed program asks for the next frame (1.10's timer
        // that updates every loop). Only a drawn one asks: a node out of bounds
        // or hidden is not emitted, and a time function's null (a static value)
        // asks nothing.
        const shaders = this.shaders;
        if (shaders.timed === true) {
            shaders.timed = false;
            this.requestRender();
        }
        // After the draw: loads start, and uploads overlap the GPU's work on
        // the draw calls (a texture uploaded now draws next frame).
        this.loader.dispatch();
        this.uploadRequested = false;
        let drawEnd = 0;
        if (telemetry !== null) {
            // The walks, then the draw and the loads it starts; the uploads are
            // timed on their own, from the same read (1.10's uploadStart).
            drawEnd = platform.now();
            telemetry.drawn(drawStart - updateStart, drawEnd - drawStart, this.scene.quads, this.flushedOps + this.ops.length, this.animationManager.active.length);
        }
        this.upload(animating, telemetry, drawEnd);
        // Over the critical threshold: free what nobody wants now (1.10 ran
        // this at the end of drawFrame), at the frame's time: still critical,
        // it runs after every drawn frame, and reads no clock.
        if (this.memory.criticalCleanupRequested === true) {
            this.memory.cleanupAt(time);
        }
        // App code runs from here on, after the frame is drawn: an error a time
        // function threw while drawing is reported (a loop error), and the
        // frame's events are delivered (one a listener raises waits for the
        // next flush, as FrameEvents says).
        // Ticked while the events are held, as on an undrawn frame: what it
        // queues (renderUpdate, fpsUpdate) goes out with the flush below, with no
        // flush timer of its own.
        if (telemetry !== null && telemetry === this.telemetry) {
            telemetry.tick(time, dt, true, animating);
        }
        events.holding = false;
        shaders.reportErrors();
        events.flush();
        // The inspector takes the frame's changes once it is drawn and its
        // events are out (a production build drops this).
        if (ENABLE_INSPECTOR === true) {
            const inspector = this.inspector;
            if (inspector !== null) {
                inspector.frame();
            }
        }
    }
    /**
     * Bring the inspector in line with the settings (1.10): destroy it when
     * turned off, build it when turned on, when its class changes or when
     * its options change (it reads them only when built), and attach it.
     */
    applyInspector(optionsChanged) {
        // In-method too, as 1.10: a production build folds the body away.
        if (ENABLE_INSPECTOR === false) {
            return;
        }
        const Class = this.settings.inspector;
        const current = this.inspector;
        if (current !== null &&
            current.constructor === Class &&
            optionsChanged === false) {
            return;
        }
        if (current !== null) {
            current.destroy();
            this.inspector = null;
        }
        if (Class === false) {
            return;
        }
        const inspector = new Class(this.canvas, this.settings);
        inspector.attach(this);
        this.inspector = inspector;
    }
    /**
     * Upload decoded textures within the frame's budget; timed for the
     * telemetry from `start` (a clock read the caller made) when there are
     * textures to upload, with one more read at the end (none otherwise).
     */
    upload(animating, telemetry, start) {
        const limit = this.settings.textureProcessingTimeLimit;
        const queued = this.textures.decodedCount;
        if (telemetry === null || queued === 0) {
            this.uploader.run(animating, limit);
            return;
        }
        const uploaded = this.uploader.run(animating, limit);
        telemetry.uploaded(queued, uploaded, this.platform.now() - start);
    }
    /**
     * Bring the telemetry in line with fpsUpdateInterval: attach it above 0
     * (the first sample starts now, and closes on time even if no frame
     * comes; while paused, its timer starts with resume()), restart it on a
     * new interval (the sample in progress is discarded, as in 1.10) and
     * detach it at 0 (nothing is sampled).
     */
    applyTelemetry() {
        // Stopped for good (destroy, a context loss): no frame comes again, so
        // a timer would close empty samples forever, and keep the renderer
        // reachable.
        if (this.loop.stopped === true) {
            return;
        }
        const interval = this.settings.fpsUpdateInterval;
        const current = this.telemetry;
        if (interval <= 0) {
            if (current !== null) {
                current.stop();
                this.telemetry = null;
            }
            return;
        }
        const now = this.platform.now();
        if (current !== null) {
            if (current.interval !== interval) {
                current.restart(interval, now);
            }
            return;
        }
        const telemetry = new Telemetry(this, this.events, this.platform, this.backend.spy, interval, now);
        telemetry.segment = this.segment;
        // A paused loop starts its timer with resume().
        if (this.loop.paused === true) {
            telemetry.halt();
        }
        else {
            telemetry.idle(now);
        }
        this.telemetry = telemetry;
    }
    /**
     * Label the `fpsUpdate` samples that follow, e.g. `'home'` or
     * `'detail-scroll'` (1.10). The sample in progress closes under the old
     * label first, so no sample spans two segments; call it on screen and
     * interaction changes, never per frame. The label is kept while the
     * telemetry is off.
     */
    setTelemetrySegment(label) {
        if (label === this.segment) {
            return;
        }
        const telemetry = this.telemetry;
        if (telemetry !== null) {
            telemetry.relabel(label, this.platform.now());
        }
        this.segment = label;
    }
    /**
     * Idle maintenance, at most once per idle period, from a timer queued on
     * going idle: the GL out-of-memory probe (drained here, never in the
     * frame loop: spec 12.1), texture memory cleanup, the trim of the
     * params blocks no node holds and of the text layout cache, and the
     * layouts of the text nodes no walk has visited yet (idleTextLayouts).
     */
    maintain() {
        // Held while the work runs: its events wait for the flush below rather
        // than each arming a timer flush that would find nothing left.
        const events = this.events;
        events.holding = true;
        if (this.backend.outOfMemory() === true) {
            this.memory.handleOutOfMemory();
        }
        this.memory.maintain();
        this.shaders.trim();
        this.textNodes.trim();
        this.textNodes.layoutAhead();
        events.holding = false;
        events.flush();
    }
    /** Texture memory in use (1.10 txMemManager.getMemoryInfo). */
    memoryInfo() {
        return this.memory.info();
    }
    /**
     * Free the textures nobody wants now, down to the target threshold (all
     * of them with `full`), and remove the ones nothing references (1.10
     * stage.cleanup). Their `freed` events are delivered before it returns
     * (called from a listener: with the next flush; inside a frame, from a
     * reprocessUpdates callback: with the frame's, after the draw).
     */
    cleanup(full) {
        // Held as in maintain(); a frame that already holds them keeps them.
        const events = this.events;
        const held = events.holding;
        events.holding = true;
        this.memory.cleanup(full === true);
        events.holding = held;
        events.flush();
    }
    /** 1.10 alias of requestRender. */
    rerender() {
        this.requestRender();
    }
    /** The backend and device limits; reads GL parameters, so call it once. */
    getCapabilities() {
        return this.backend.getCapabilities();
    }
    /**
     * Change runtime settings (spec 13.2) through the constructor's
     * resolvers; each effect runs once, after every value is stored. After
     * destroy() it does nothing.
     */
    setOptions(options) {
        // Destroyed: nothing is left to apply them to, and an effect would
        // build what nothing takes down again (an inspector's overlay and its
        // wrapped Node setters, a timer).
        if (this.destroyed === true) {
            return;
        }
        const s = this.settings;
        let effects = 0;
        for (const key in options) {
            // Own keys of the table only: an inherited name is not a setting.
            if (hasOwn.call(runtimeSettings, key) === false) {
                continue;
            }
            const k = key;
            const setting = runtimeSettings[k];
            s[k] = setting.resolve(options[k], s[k]);
            effects |= setting.effect;
        }
        if ((effects & APPLY_CLEAR_COLOR) !== 0) {
            this.backend.setClearColor(s.clearColor);
            this.requestRender();
        }
        if ((effects & APPLY_TARGET_FPS) !== 0) {
            this.loop.targetFrameTime = frameTime(s.targetFPS);
        }
        if ((effects & APPLY_ANIMATION_SNAP) !== 0) {
            this.snapper.period = frameTime(s.animationSnapRate);
            this.snapper.reset();
        }
        if ((effects & APPLY_TEXTURE_MEMORY) !== 0) {
            this.memory.updateSettings(s.textureMemory);
            this.cleanup(false);
        }
        if ((effects & APPLY_TELEMETRY) !== 0) {
            this.applyTelemetry();
        }
        if (ENABLE_INSPECTOR === true &&
            (effects & (APPLY_INSPECTOR | APPLY_INSPECTOR_OPTIONS)) !== 0) {
            this.applyInspector((effects & APPLY_INSPECTOR_OPTIONS) !== 0);
        }
        if ((effects & APPLY_BOUNDS_MARGIN) !== 0) {
            // A copy of the resolved tuple, as at construction.
            this.view.margin = normalizeBoundsMargin(s.boundsMargin);
            // No node moved, so nothing is dirty: re-derive from the root down so
            // that every visited node is classified against the new margin.
            this.nodes.markDirty(this.root.id, DIRTY_INHERITED);
        }
    }
    /**
     * Stop drawing once no animation is active (the frame an animation ends
     * on is drawn first); with `immediate`, stop at the next frame before
     * anything is drawn (a host leaving the foreground). Nothing is drawn
     * or sampled while paused: writes made meanwhile land on the first frame
     * after resume().
     */
    pause(options) {
        this.loop.pause(options !== undefined && options.immediate === true);
    }
    /** Restart a paused loop with a fresh frame, or cancel a pause still waiting on animations. */
    resume() {
        if (this.loop.resume() === true) {
            // The telemetry starts a new burst, so the first frame after the
            // pause is not paired with a delta, and its timer again (the pause
            // halted it).
            const telemetry = this.telemetry;
            if (telemetry !== null) {
                telemetry.idle(this.platform.now());
            }
            this.requestRender();
        }
    }
    /** The loop has stopped after pause(); false while a pause waits on animations. */
    get isPaused() {
        return this.loop.paused;
    }
    /**
     * Stop the loop, destroy the scene, release the GL context and detach a
     * canvas the renderer created (spec 14, item 16). The context is lost
     * either way, so a canvas the app provided stays attached but cannot be
     * reused by a new Renderer: give that one a fresh canvas. A second call
     * does nothing.
     */
    destroy() {
        if (this.destroyed === true) {
            return;
        }
        this.destroyed = true;
        this.loop.stop();
        const telemetry = this.telemetry;
        if (telemetry !== null) {
            telemetry.stop();
            this.telemetry = null;
        }
        // Before the scene goes: the mirror has nothing to follow.
        if (ENABLE_INSPECTOR === true && this.inspector !== null) {
            this.inspector.destroy();
            this.inspector = null;
        }
        // A compile that found the context lost reports nothing more. Belt and
        // braces: the report's timer checks `destroyed` itself, so this only
        // avoids queuing a pointless timer.
        this.shaders.onLost = null;
        // Nobody is left to hear the queued events, and no flush comes after this;
        // nor any memory check (a cleanup on a destroyed renderer), nor a retry
        // timer for a load that fails after this.
        this.events.destroy();
        this.textEvents.destroy();
        // A font load in flight changes nothing more, and never settles.
        this.fonts.destroy();
        this.memory.destroy();
        this.textures.schedule = null;
        this.loader.destroy();
        this.uploader.destroy();
        this.root.destroy();
        this.backend.destroy();
        // Some hosts' canvases have no parentNode at all, not even null.
        const parent = this.canvas.parentNode;
        if (this.ownsCanvas === true && parent !== null && parent !== undefined) {
            parent.removeChild(this.canvas);
        }
        this.removeAllListeners();
    }
}
//# sourceMappingURL=Renderer.js.map