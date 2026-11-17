import { CORE_DEFAULTS, resolveQuadBufferSize, } from './core/RendererCore.js';
import { normalizeBoundsMargin } from './common/types.js';
// What a runtime change does beyond storing the value; bit flags so that
// one setOptions call runs each effect once. 0: read where it is used.
export const APPLY_CLEAR_COLOR = 1;
export const APPLY_TARGET_FPS = 2;
export const APPLY_BOUNDS_MARGIN = 4;
export const APPLY_TEXTURE_MEMORY = 8;
export const APPLY_TELEMETRY = 16;
export const APPLY_INSPECTOR = 32;
export const APPLY_INSPECTOR_OPTIONS = 64;
export const APPLY_ANIMATION_SNAP = 128;
const positive = (value, fallback) => value !== undefined && value > 0 ? value : fallback;
const resolveTextureMemory = (value, current) => {
    const v = value ?? {};
    const c = current ?? {};
    return {
        criticalThreshold: v.criticalThreshold ?? c.criticalThreshold ?? 200e6,
        targetThresholdLevel: v.targetThresholdLevel ?? c.targetThresholdLevel ?? 0.8,
        cleanupInterval: v.cleanupInterval ?? c.cleanupInterval ?? 5000,
        debugLogging: v.debugLogging ?? c.debugLogging ?? false,
        baselineMemoryAllocation: v.baselineMemoryAllocation ?? c.baselineMemoryAllocation ?? 26e6,
        doNotExceedCriticalThreshold: v.doNotExceedCriticalThreshold ?? c.doNotExceedCriticalThreshold ?? false,
    };
};
/**
 * Every runtime setting: how it resolves and what a change does. The
 * constructor and setOptions both resolve through this table, and the
 * mapped type fails to compile until a new runtime setting has an entry.
 */
export const runtimeSettings = {
    clearColor: { resolve: (v) => v ?? 0, effect: APPLY_CLEAR_COLOR },
    // Undefined or 0 or less is uncapped: the loop draws on every vsync.
    targetFPS: {
        resolve: (v) => (v !== undefined && v > 0 ? v : 0),
        effect: APPLY_TARGET_FPS,
    },
    // Undefined or 0 or less steps animations by the frame delta.
    animationSnapRate: {
        resolve: (v) => positive(v, 0),
        effect: APPLY_ANIMATION_SNAP,
    },
    boundsMargin: {
        resolve: (v) => normalizeBoundsMargin(v ?? CORE_DEFAULTS.boundsMargin),
        effect: APPLY_BOUNDS_MARGIN,
    },
    // 1.10's effect: apply the new thresholds, then run a cleanup.
    textureMemory: {
        resolve: resolveTextureMemory,
        effect: APPLY_TEXTURE_MEMORY,
    },
    // Attaches, restarts or detaches the telemetry.
    fpsUpdateInterval: {
        resolve: (v) => positive(v, 0),
        effect: APPLY_TELEMETRY,
    },
    textureProcessingTimeLimit: { resolve: (v) => positive(v, 25), effect: 0 },
    // 1.10's effects: build or tear down the inspector on a toggle, and,
    // since it reads its options only when built, build it anew for new ones.
    inspector: { resolve: (v) => v ?? false, effect: APPLY_INSPECTOR },
    inspectorOptions: {
        resolve: (v) => v ?? {},
        effect: APPLY_INSPECTOR_OPTIONS,
    },
};
const initial = (key, value) => runtimeSettings[key].resolve(value, undefined);
const noop = () => { };
const windowPixelRatio = () => typeof window !== 'undefined' ? window.devicePixelRatio : undefined;
/**
 * Resolve every setting key by key with 1.10's defaults (Renderer.ts
 * 966-1027), without Object.assign (Chrome 45).
 * `canvas` is the canvas in use: the app's, or one the platform created.
 */
export function resolveSettings(s, canvas) {
    return {
        appWidth: positive(s.appWidth, CORE_DEFAULTS.appWidth),
        appHeight: positive(s.appHeight, CORE_DEFAULTS.appHeight),
        deviceLogicalPixelRatio: positive(s.deviceLogicalPixelRatio, CORE_DEFAULTS.deviceLogicalPixelRatio),
        devicePhysicalPixelRatio: positive(s.devicePhysicalPixelRatio, positive(windowPixelRatio(), CORE_DEFAULTS.devicePhysicalPixelRatio)),
        quadBufferSize: resolveQuadBufferSize(s.quadBufferSize),
        canvas,
        platform: s.platform ?? null,
        clearColor: initial('clearColor', s.clearColor),
        targetFPS: initial('targetFPS', s.targetFPS),
        animationSnapRate: initial('animationSnapRate', s.animationSnapRate),
        boundsMargin: initial('boundsMargin', s.boundsMargin),
        textureMemory: initial('textureMemory', s.textureMemory),
        fpsUpdateInterval: initial('fpsUpdateInterval', s.fpsUpdateInterval),
        textureProcessingTimeLimit: initial('textureProcessingTimeLimit', s.textureProcessingTimeLimit),
        inspector: initial('inspector', s.inspector),
        inspectorOptions: initial('inspectorOptions', s.inspectorOptions),
        textLayoutCacheSize: s.textLayoutCacheSize ?? CORE_DEFAULTS.textLayoutCacheSize,
        idleTextLayouts: s.idleTextLayouts ?? CORE_DEFAULTS.idleTextLayouts,
        textBaselineMode: s.textBaselineMode ?? CORE_DEFAULTS.textBaselineMode,
        numImageWorkers: s.numImageWorkers === undefined ? 1 : Math.min(s.numImageWorkers, 1),
        imageDecodeConcurrency: s.imageDecodeConcurrency ?? 14,
        createImageBitmapSupport: s.createImageBitmapSupport ?? 'auto',
        premultiplyAlphaHonored: s.premultiplyAlphaHonored ?? true,
        maxRetryCount: s.maxRetryCount ?? 5,
        enableContextSpy: s.enableContextSpy ?? false,
        forceWebGL2: s.forceWebGL2 ?? false,
        disableVertexArrayObject: s.disableVertexArrayObject ?? false,
        powerPreference: s.powerPreference ?? 'default',
        handleLoopError: s.handleLoopError ?? noop,
        wakeFallbackDelay: s.wakeFallbackDelay === undefined
            ? 50
            : s.wakeFallbackDelay > 0
                ? s.wakeFallbackDelay
                : 0,
        presentOnIdle: s.presentOnIdle ?? false,
    };
}
//# sourceMappingURL=settings.js.map