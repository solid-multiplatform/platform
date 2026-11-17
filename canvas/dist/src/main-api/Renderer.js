import { EventEmitter } from '../common/EventEmitter.js';
import { ENABLE_INSPECTOR } from '../utils.js';
import { Stage } from '../core/Stage.js';
import { CoreNode } from '../core/CoreNode.js';
import {} from '../core/CoreTextNode.js';
import { WebPlatform } from '../core/platforms/web/WebPlatform.js';
import { Platform, getDefaultPlatform } from '../core/platforms/Platform.js';
import { normalizeBoundsMargin, } from '../common/CommonTypes.js';
/** Shared default `handleLoopError` — swallows the error, keeping the loop alive. */
const noop = () => { };
/**
 * The Renderer Main API
 *
 * @remarks
 * This is the primary class used to configure and operate the Renderer.
 *
 * It is used to create and destroy Nodes, as well as Texture and Shader
 * references.
 *
 * Example:
 * ```ts
 * import { RendererMain, MainCoreDriver } from '@lightningjs/renderer';
 *
 * // Initialize the Renderer
 * const renderer = new RendererMain(
 *   {
 *     appWidth: 1920,
 *     appHeight: 1080
 *   },
 *   'app',
 *   new MainCoreDriver(),
 * );
 * ```
 *
 * ## Event Handling
 *
 * Listen to events using the standard EventEmitter API:
 * ```typescript
 * renderer.on('fpsUpdate', (_target, data: RendererMainFpsUpdateEvent) => {
 *   console.log(`FPS: ${data.fps}`);
 * });
 *
 * renderer.on('idle', () => {
 *   // Renderer is idle - no scene changes
 * });
 * ```
 *
 * @see {@link RendererMainFpsUpdateEvent}
 * @see {@link RendererMainFrameTickEvent}
 * @see {@link RendererMainRenderUpdateEvent}
 * @see {@link RendererMainIdleEvent}
 * @see {@link RendererMainCriticalCleanupEvent}
 * @see {@link RendererMainCriticalCleanupFailedEvent}
 * @see {@link RendererMainContextLostEvent}
 * @see {@link RendererMainOutOfMemoryEvent}
 *
 * @fires RendererMain#fpsUpdate
 * @fires RendererMain#frameTick
 * @fires RendererMain#renderUpdate
 * @fires RendererMain#idle
 * @fires RendererMain#criticalCleanup
 * @fires RendererMain#criticalCleanupFailed
 * @fires RendererMain#contextLost
 * @fires RendererMain#outOfMemory
 */
// Undefined caps at 60: on TV targets an uncapped loop draws every catch-up
// rAF the browser fires under GPU load (measured ~140fps on a 60Hz panel).
// Explicit 0 (or negative, matching the runtime setter's clamp) opts out.
export const resolveTargetFPS = (fps) => {
    if (fps === undefined) {
        return 60;
    }
    return fps > 0 ? fps : 0;
};
const windowDevicePixelRatio = () => typeof window !== 'undefined' ? window.devicePixelRatio : undefined;
/**
 * Resolve texture memory settings, filling each field from `current` (the
 * settings in effect) and then from the defaults.
 */
const resolveTxSettings = (textureMemory, current) => {
    const tx = textureMemory ?? {};
    const cur = current ?? {};
    return {
        criticalThreshold: tx.criticalThreshold ?? cur.criticalThreshold ?? 200e6,
        targetThresholdLevel: tx.targetThresholdLevel ?? cur.targetThresholdLevel ?? 0.8,
        cleanupInterval: tx.cleanupInterval ?? cur.cleanupInterval ?? 5000,
        debugLogging: tx.debugLogging ?? cur.debugLogging ?? false,
        baselineMemoryAllocation: tx.baselineMemoryAllocation ?? cur.baselineMemoryAllocation ?? 26e6,
        doNotExceedCriticalThreshold: tx.doNotExceedCriticalThreshold ??
            cur.doNotExceedCriticalThreshold ??
            false,
    };
};
// What a runtime settings change must do beyond storing the value; a setting
// with no effect is read live from `stage.options`. Bit flags so a batch of
// changes runs each effect once, in the order listed.
const APPLY_TEXTURE_MEMORY = 1;
const APPLY_TARGET_FPS = 2;
const APPLY_INSPECTOR = 4;
const APPLY_INSPECTOR_OPTIONS = 8;
const APPLY_BOUNDS_MARGIN = 32;
const APPLY_CLEAR_COLOR = 64;
/**
 * Every runtime setting: how it resolves and what changing it does. The
 * constructor and `setOptions` both resolve through this table, so a value
 * can't be defaulted one way at startup and another at runtime, and the
 * mapped type makes a new runtime setting fail to compile until its entry
 * says what a change must do.
 */
const runtimeSettings = {
    textureMemory: {
        resolve: (v, current) => resolveTxSettings(v, current),
        effect: APPLY_TEXTURE_MEMORY,
    },
    boundsMargin: {
        resolve: (v) => normalizeBoundsMargin(v ?? 200),
        effect: APPLY_BOUNDS_MARGIN,
    },
    clearColor: { resolve: (v) => v ?? 0x00000000, effect: APPLY_CLEAR_COLOR },
    targetFPS: { resolve: (v) => resolveTargetFPS(v), effect: APPLY_TARGET_FPS },
    inspector: { resolve: (v) => v ?? false, effect: APPLY_INSPECTOR },
    inspectorOptions: {
        resolve: (v) => v ?? {},
        effect: APPLY_INSPECTOR_OPTIONS,
    },
    // Read live each frame.
    fpsUpdateInterval: { resolve: (v) => v || 0, effect: 0 },
    textureProcessingTimeLimit: { resolve: (v) => v || 10, effect: 0 },
};
const hasOwn = Object.prototype.hasOwnProperty;
const initialSetting = (key, value) => runtimeSettings[key].resolve(value, undefined);
export class RendererMain extends EventEmitter {
    root;
    canvas;
    stage;
    inspector = null;
    /**
     * Constructs a new Renderer instance
     *
     * @param settings Renderer settings
     * @param target Element ID or HTMLElement to insert the canvas into
     * @param driver Core Driver to use
     */
    constructor(settings, target) {
        super();
        // The platform comes first: a host's platform may constrain the settings
        // before the defaults below apply. The app's setting wins over the host's
        // registered default, and the web platform stands in for neither.
        const platformClass = settings.platform ?? getDefaultPlatform();
        let platform;
        if (platformClass !== undefined &&
            platformClass !== null &&
            platformClass.prototype instanceof Platform === true) {
            // @ts-ignore - if Platform is a valid class, it will be used
            platform = new platformClass();
        }
        else {
            platform = new WebPlatform();
        }
        settings = platform.resolveSettings(settings);
        const canvas = settings.canvas || platform.createCanvas();
        // The one resolved options object: the stage keeps it as `stage.options`
        // (also exposed as `renderer.settings`), and `setOptions` updates it in
        // place. Runtime settings resolve through `runtimeSettings`; the rest are
        // fixed at construction.
        const options = {
            appWidth: settings.appWidth || 1920,
            appHeight: settings.appHeight || 1080,
            deviceLogicalPixelRatio: settings.deviceLogicalPixelRatio || 1,
            devicePhysicalPixelRatio: settings.devicePhysicalPixelRatio || windowDevicePixelRatio() || 1,
            textureMemory: resolveTxSettings(settings.textureMemory, undefined),
            boundsMargin: initialSetting('boundsMargin', settings.boundsMargin),
            clearColor: initialSetting('clearColor', settings.clearColor),
            targetFPS: initialSetting('targetFPS', settings.targetFPS),
            inspector: initialSetting('inspector', settings.inspector),
            inspectorOptions: initialSetting('inspectorOptions', settings.inspectorOptions),
            fpsUpdateInterval: initialSetting('fpsUpdateInterval', settings.fpsUpdateInterval),
            textureProcessingTimeLimit: initialSetting('textureProcessingTimeLimit', settings.textureProcessingTimeLimit),
            canvas,
            eventBus: this,
            platform,
            textLayoutCacheSize: settings.textLayoutCacheSize ?? 250,
            // Clamped to at most 1: the worker is a non-blocking dispatcher, so a
            // pool adds isolates without adding throughput. See `numImageWorkers`.
            numImageWorkers: settings.numImageWorkers !== undefined
                ? Math.min(settings.numImageWorkers, 1)
                : 1,
            imageDecodeConcurrency: settings.imageDecodeConcurrency !== undefined
                ? settings.imageDecodeConcurrency
                : 4,
            enableContextSpy: settings.enableContextSpy ?? false,
            forceWebGL2: settings.forceWebGL2 ?? false,
            disableVertexArrayObject: settings.disableVertexArrayObject ?? false,
            powerPreference: settings.powerPreference ?? 'default',
            renderEngine: settings.renderEngine,
            // 16384 quads x 80 bytes — the most a Uint16 index buffer can address.
            // Kept as a literal so the Canvas2D build doesn't pull in WebGL internals
            // for a constant; MAX_QUAD_BUFFER_SIZE in RendererUtils.ts is the source
            // of truth (and is asserted equal to this literal in its unit test) and
            // clamps anything larger.
            quadBufferSize: settings.quadBufferSize ?? 1310720,
            fontEngines: settings.fontEngines ?? [],
            textBaselineMode: settings.textBaselineMode ?? 'optical',
            createImageBitmapSupport: settings.createImageBitmapSupport || 'auto',
            // undefined -> true (assume honored, no probe); 'auto' -> probe;
            // explicit boolean -> force the value.
            premultiplyAlphaHonored: settings.premultiplyAlphaHonored === undefined
                ? true
                : settings.premultiplyAlphaHonored,
            maxRetryCount: settings.maxRetryCount ?? 5,
            // Default to a no-op so a thrown frame is swallowed and the render loop
            // never crashes; apps can override to log/report.
            handleLoopError: settings.handleLoopError ?? noop,
        };
        const { appWidth, appHeight, deviceLogicalPixelRatio, devicePhysicalPixelRatio, } = options;
        const deviceLogicalWidth = appWidth * deviceLogicalPixelRatio;
        const deviceLogicalHeight = appHeight * deviceLogicalPixelRatio;
        this.canvas = canvas;
        platform.sizeCanvas(canvas, deviceLogicalWidth * devicePhysicalPixelRatio, deviceLogicalHeight * devicePhysicalPixelRatio, deviceLogicalWidth, deviceLogicalHeight);
        this.stage = new Stage(options);
        // Extract the root node
        this.root = this.stage.root;
        // Get the target element and attach the canvas to it
        if (target) {
            let targetEl;
            if (typeof target === 'string') {
                targetEl = platform.getElementById(target);
            }
            else {
                targetEl = target;
            }
            if (!targetEl) {
                throw new Error('Could not find target element');
            }
            targetEl.appendChild(canvas);
        }
        else if (settings.canvas !== canvas) {
            throw new Error('New canvas element could not be appended to undefined target');
        }
        // Initialize inspector (if enabled)
        const inspector = options.inspector;
        if (inspector !== false && ENABLE_INSPECTOR) {
            this.inspector = new inspector(canvas, options);
        }
    }
    /**
     * Create a new scene graph node
     *
     * @remarks
     * A node is the main graphical building block of the Renderer scene graph. It
     * can be a container for other nodes, or it can be a leaf node that renders a
     * solid color, gradient, image, or specific texture, using a specific shader.
     *
     * To create a text node, see {@link createTextNode}.
     *
     * See {@link CoreNode} for more details.
     *
     * @param props
     * @returns
     */
    createNode(props, resolved = false) {
        const node = this.stage.createNode(props, resolved);
        if (ENABLE_INSPECTOR && this.inspector) {
            return this.inspector.createNode(node);
        }
        return node;
    }
    /**
     * Allocate a fully-resolved CoreNodeProps bag — the same shape and
     * defaults the renderer would otherwise build inside `createNode`.
     *
     * Frameworks (e.g. solid-tv) call this once per node at construction
     * time, fill it in as user props flow in, then pass it back via
     * `createNode(props, true)`.  The renderer adopts the bag directly:
     * one allocation instead of two, and a stable hidden class for the
     * node's lifetime.
     */
    createNodeProps(initial) {
        return this.stage.createNodeProps(initial);
    }
    /**
     * Create a new scene graph text node
     *
     * @remarks
     * A text node is the second graphical building block of the Renderer scene
     * graph. It renders text using a specific text renderer that is automatically
     * chosen based on the font requested and what type of fonts are installed
     * into an app.
     *
     * See {@link ITextNode} for more details.
     *
     * @param props
     * @returns
     */
    createTextNode(props, resolved = false) {
        const textNode = this.stage.createTextNode(props, resolved);
        if (ENABLE_INSPECTOR && this.inspector) {
            return this.inspector.createTextNode(textNode);
        }
        return textNode;
    }
    /**
     * Allocate a fully-resolved CoreTextNodeProps bag.  See
     * {@link createNodeProps}.
     */
    createTextNodeProps(initial) {
        return this.stage.createTextNodeProps(initial);
    }
    /**
     * Destroy a node
     *
     * @remarks
     * This method destroys a node
     *
     * @param node
     * @returns
     */
    destroyNode(node) {
        if (ENABLE_INSPECTOR && this.inspector) {
            this.inspector.destroyNode(node);
        }
        return node.destroy();
    }
    /**
     * Create a new texture reference
     *
     * @remarks
     * This method creates a new reference to a texture. The texture is not
     * loaded until it is used on a node.
     *
     * It can be assigned to a node's `texture` property, or it can be used
     * when creating a SubTexture.
     *
     * @param textureType
     * @param props
     * @param options
     * @returns
     */
    createTexture(textureType, props) {
        return this.stage.txManager.createTexture(textureType, props);
    }
    /**
     * Create a new shader controller for a shader type
     *
     * @remarks
     * This method creates a new Shader Controller for a specific shader type.
     *
     * If the shader has not been loaded yet, it will be loaded. Otherwise, the
     * existing shader will be reused.
     *
     * It can be assigned to a Node's `shader` property.
     *
     * @param shaderType
     * @param props
     * @returns
     */
    createShader(shType, props) {
        return this.stage.shManager.createShader(shType, props);
    }
    /**
     * Get a Node by its ID
     *
     * @param id
     * @returns
     */
    getNodeById(id) {
        const root = this.stage?.root;
        if (!root) {
            return null;
        }
        const findNode = (node) => {
            if (node.id === id) {
                return node;
            }
            for (const child of node.children) {
                const found = findNode(child);
                if (found) {
                    return found;
                }
            }
            return null;
        };
        return findNode(root);
    }
    getBufferInfo() {
        return this.stage.renderer.getBufferInfo();
    }
    /**
     * Report the active rendering backend and device capabilities.
     *
     * @remarks
     * Useful for diagnostics and field logging — e.g. confirming which WebGL
     * version a device negotiated and whether Vertex Array Objects engaged.
     * Reads live GL parameters (CPU↔GPU round-trips), so call once at startup
     * rather than per frame.
     *
     * @example
     * ```ts
     * console.table(renderer.getCapabilities());
     * ```
     */
    getCapabilities() {
        return this.stage.renderer.getCapabilities();
    }
    /**
     * Label the `fpsUpdate` samples that follow.
     *
     * @remarks
     * Group telemetry by what the app was doing, e.g. `'home'`,
     * `'detail-scroll'`, `'player'`. Without it every sample is a blend of
     * whatever the session happened to be doing at the time, which makes
     * segment-level comparison impossible.
     *
     * Changing the label closes the sample in progress and emits it under the
     * OLD label, so no interval ever spans two segments. Call this on screen and
     * interaction changes, never per frame.
     *
     * @example
     * ```ts
     * router.on('enter', (screen) => renderer.setTelemetrySegment(screen.name));
     * ```
     */
    setTelemetrySegment(label) {
        this.stage.setTelemetrySegment(label);
    }
    /**
     * Re-render the current frame without advancing any running animations.
     *
     * @remarks
     * Any state changes will be reflected in the re-rendered frame. Useful for
     * debugging.
     *
     * May not do anything if the render loop is running on a separate worker.
     */
    rerender() {
        this.stage.requestRender();
    }
    /**
     * Stop the render loop so it schedules no frames, timers or idle polls.
     *
     * @remarks
     * Animations are never frozen mid-flight: while any animation is active the
     * loop keeps running, and it stops once the last one has finished and its
     * final frame is drawn. Poll {@link isPaused} to see whether it has stopped.
     *
     * With `immediate` the loop stops on its next tick before it draws
     * anything, animations included: they freeze where they are and carry on
     * after {@link resume}. For a host leaving the foreground, where a frame
     * drawn from the background gets the app killed on Apple platforms.
     *
     * While paused nothing is drawn, no texture uploads or idle cleanup run, and
     * `frameTick`, `idle` and `fpsUpdate` stop firing. Scene changes made while
     * paused appear on the first frame after {@link resume}.
     *
     * @example
     * ```ts
     * renderer.pause();
     * // later
     * renderer.resume();
     * ```
     */
    pause(options) {
        this.stage.pauseLoop(options?.immediate === true);
    }
    /**
     * Restart a paused render loop, or cancel a pause still waiting on
     * animations. Does nothing if the loop is running.
     */
    resume() {
        this.stage.resumeLoop();
    }
    /**
     * `true` once the render loop has actually stopped after {@link pause}.
     * Stays `false` while a pause is waiting for animations to finish.
     */
    get isPaused() {
        return this.stage.isLoopPaused;
    }
    /**
     * Cleanup textures that are not being used
     *
     * @param aggressive - If true, will cleanup all textures, regardless of render status
     *
     * @remarks
     * This can be used to free up GFX memory used by textures that are no longer
     * being displayed.
     *
     * This routine is also called automatically when the memory used by textures
     * exceeds the critical threshold on frame generation **OR** when the renderer
     * is idle and the memory used by textures exceeds the target threshold.
     *
     * **NOTE**: This is a heavy operation and should be used sparingly.
     * **NOTE2**: This will not cleanup textures that are currently being displayed.
     * **NOTE3**: This will not cleanup textures that are marked as `preventCleanup`.
     * **NOTE4**: This has nothing to do with the garbage collection of JavaScript.
     */
    cleanup() {
        this.stage.cleanup();
    }
    /**
     * Sets the clear color for the stage.
     *
     * @param color - The color to set as the clear color.
     */
    setClearColor(color) {
        this.stage.setClearColor(color);
    }
    /**
     * Set options for the renderer
     *
     * @param options
     */
    setOptions(options) {
        const stage = this.stage;
        const stageOptions = stage.options;
        // Resolve each setting the way the constructor does and collect what the
        // batch must do, so every effect runs once, after all values are stored.
        let effects = 0;
        for (const key in options) {
            // Own keys only: an inherited name ('constructor', 'toString') would
            // otherwise resolve to an Object.prototype function, not a setting.
            if (hasOwn.call(runtimeSettings, key) === false) {
                continue;
            }
            const k = key;
            const setting = runtimeSettings[k];
            stageOptions[k] = setting.resolve(options[k], stageOptions[k]);
            effects |= setting.effect;
        }
        if ((effects & APPLY_TEXTURE_MEMORY) !== 0) {
            stage.txMemManager.updateSettings(stageOptions.textureMemory);
            stage.txMemManager.cleanup();
        }
        if ((effects & APPLY_TARGET_FPS) !== 0) {
            stage.updateTargetFrameTime();
        }
        if ((effects & (APPLY_INSPECTOR | APPLY_INSPECTOR_OPTIONS)) !== 0) {
            this.applyInspector((effects & APPLY_INSPECTOR_OPTIONS) !== 0);
        }
        if ((effects & APPLY_BOUNDS_MARGIN) !== 0) {
            stage.setBoundsMargin(stageOptions.boundsMargin);
        }
        if ((effects & APPLY_CLEAR_COLOR) !== 0) {
            stage.setClearColor(stageOptions.clearColor);
        }
    }
    /**
     * Bring the Inspector in line with `stage.options`: destroy it when turned
     * off, and (re)create it when turned on, when its class changes, or when
     * its options change (it reads them only at construction).
     */
    applyInspector(optionsChanged) {
        if (ENABLE_INSPECTOR === false) {
            return;
        }
        const inspectorClass = this.stage.options.inspector;
        const current = this.inspector;
        if (current !== null &&
            current.constructor === inspectorClass &&
            optionsChanged === false) {
            return;
        }
        if (current !== null) {
            current.destroy();
            this.inspector = null;
        }
        if (inspectorClass === false) {
            return;
        }
        this.inspector = new inspectorClass(this.canvas, this.stage.options);
        this.inspector.createNodes(this.root);
    }
    get settings() {
        return this.stage.options;
    }
    /**
     * Gets the frame-rate cap for the global render loop
     *
     * @returns The current cap in frames per second (0 means uncapped)
     *
     * @remarks
     * This caps the frame rate of the entire rendering system. When 0, the
     * loop draws on every `requestAnimationFrame` the browser fires, which
     * can exceed the display refresh rate under GPU load. Defaults to 60.
     */
    get targetFPS() {
        return this.stage.options.targetFPS || 0;
    }
    /**
     * Sets the frame-rate cap for the global render loop
     *
     * @param fps - The cap in frames per second. Set to 0 or a negative value
     *              to remove the cap entirely.
     *
     * @remarks
     * This setting affects the entire rendering system immediately.
     * All animations, rendering, and frame updates will be capped at this
     * rate. Defaults to 60 — see {@link RendererRuntimeSettings.targetFPS}
     * for why an uncapped loop is unsafe on TV hardware.
     *
     * @example
     * ```typescript
     * // Cap at 30fps for better performance
     * renderer.targetFPS = 30;
     *
     * // Remove the cap (draw on every rAF; can exceed panel refresh rate)
     * renderer.targetFPS = 0;
     * ```
     */
    set targetFPS(fps) {
        this.setOptions({ targetFPS: fps });
    }
}
//# sourceMappingURL=Renderer.js.map