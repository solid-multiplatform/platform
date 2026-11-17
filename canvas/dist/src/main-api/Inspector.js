import { CoreNode, } from '../core/CoreNode.js';
import {} from './Renderer.js';
import { ENABLE_INSPECTOR } from '../utils.js';
import { CoreTextNode } from '../core/CoreTextNode.js';
import { TextureType } from '../core/textures/Texture.js';
const stylePropertyMap = {
    alpha: (v) => {
        if (v === 1) {
            return null;
        }
        return { prop: 'opacity', value: `${v}` };
    },
    x: (x) => {
        return { prop: 'left', value: `${x}px` };
    },
    y: (y) => {
        return { prop: 'top', value: `${y}px` };
    },
    w: (w) => {
        if (w === 0) {
            return { prop: 'width', value: 'auto' };
        }
        return { prop: 'width', value: `${w}px` };
    },
    h: (h) => {
        if (h === 0) {
            return { prop: 'height', value: 'auto' };
        }
        return { prop: 'height', value: `${h}px` };
    },
    fontSize: (fs) => {
        if (fs === 0) {
            return null;
        }
        return { prop: 'font-size', value: `${fs}px` };
    },
    lineHeight: (lh) => {
        if (lh === 0) {
            return null;
        }
        return { prop: 'line-height', value: `${lh}px` };
    },
    zIndex: () => 'z-index',
    fontFamily: () => 'font-family',
    fontStyle: () => 'font-style',
    letterSpacing: () => 'letter-spacing',
    textAlign: () => 'text-align',
    overflowSuffix: () => 'overflow-suffix',
    maxLines: () => 'max-lines',
    contain: () => 'contain',
    verticalAlign: () => 'vertical-align',
    clipping: (v) => {
        if (v === false) {
            return null;
        }
        return { prop: 'overflow', value: v ? 'hidden' : 'visible' };
    },
    rotation: (v) => {
        if (v === 0) {
            return null;
        }
        return { prop: 'transform', value: `rotate(${v}rad)` };
    },
    scale: (v) => {
        if (v === 1) {
            return null;
        }
        return { prop: 'transform', value: `scale(${v})` };
    },
    scaleX: (v) => {
        if (v === 1) {
            return null;
        }
        return { prop: 'transform', value: `scaleX(${v})` };
    },
    scaleY: (v) => {
        if (v === 1) {
            return null;
        }
        return { prop: 'transform', value: `scaleY(${v})` };
    },
    color: (v) => {
        if (v === 0) {
            return null;
        }
        return { prop: 'color', value: convertColorToRgba(v) };
    },
};
const convertColorToRgba = (color) => {
    const a = (color & 0xff) / 255;
    const b = (color >> 8) & 0xff;
    const g = (color >> 16) & 0xff;
    const r = (color >> 24) & 0xff;
    return `rgba(${r},${g},${b},${a})`;
};
const domPropertyMap = {
    id: 'test-id',
};
const gradientColorPropertyMap = [
    'colorTop',
    'colorBottom',
    'colorLeft',
    'colorRight',
    'colorTl',
    'colorTr',
    'colorBl',
    'colorBr',
];
const textureTypeNames = {
    [TextureType.generic]: 'generic',
    [TextureType.color]: 'color',
    [TextureType.image]: 'image',
    [TextureType.noise]: 'noise',
    [TextureType.subTexture]: 'subTexture',
};
const knownProperties = new Set([
    ...Object.keys(stylePropertyMap),
    ...Object.keys(domPropertyMap),
    // ...gradientColorPropertyMap,
    'src',
    'parent',
    'data',
    'text',
    'texture',
    'mount',
    'mountX',
    'mountY',
    'componentName',
    'componentLocation',
]);
/**
 * Convert a PascalCase or camelCase component name to a valid custom-element
 * tag name by inserting hyphens before uppercase letters and lower-casing.
 * A mandatory "x-" prefix is added so the name always contains a hyphen,
 * which is required by the Custom Elements spec.
 *
 * Examples:
 *   "MyButton"   → "x-my-button"
 *   "FocusRing"  → "x-focus-ring"
 *   "view"       → "x-view"
 */
function toCustomElementTag(componentName) {
    const kebab = componentName
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
        .replace(/^-/, ''); // strip leading hyphen if name starts with uppercase
    return `${kebab}-x`;
}
/**
 * Registry of custom element tag names that have already been defined so we
 * only call customElements.define() once per unique component name.
 */
const registeredCustomElements = new Set();
/**
 * Ensure a minimal custom element class is registered for the given tag name.
 * The element extends HTMLElement with no additional behaviour; its only
 * purpose is to make Chrome DevTools show the component name in the Elements
 * panel.
 */
function ensureCustomElement(tagName) {
    if (registeredCustomElements.has(tagName)) {
        return;
    }
    registeredCustomElements.add(tagName);
    // Guard: skip if already defined (e.g. by another module) or if the
    // Custom Elements API is unavailable (SSR / test environments).
    if (typeof customElements === 'undefined' ||
        customElements.get(tagName) !== undefined) {
        return;
    }
    customElements.define(tagName, class extends HTMLElement {
    });
}
export class Inspector {
    root = null;
    canvas = null;
    mutationObserver = new MutationObserver(() => { });
    resizeObserver = new ResizeObserver(() => { });
    // Keyed weakly: a texture that is swapped off a node is never revisited by
    // the inspector, and a strong map would pin it (and its bitmap) for the
    // lifetime of the renderer.
    textureMetrics = new WeakMap();
    // Stable reference so the same function can be passed to both
    // add/removeEventListener — `.bind()` returns a new fn each call, so binding
    // inline in destroy() would never actually remove the listener.
    boundSetRootPosition = this.setRootPosition.bind(this);
    // Performance monitoring for frequent setter calls
    static setterCallCount = new Map();
    // Animation monitoring structures
    static activeAnimations = new Map();
    static animationHistory = [];
    // Performance monitoring settings (configured via constructor)
    performanceSettings = {
        enablePerformanceMonitoring: false,
        excessiveCallThreshold: 100,
        resetInterval: 5000,
        enableAnimationMonitoring: false,
        maxAnimationHistory: 1000,
        animationStatsInterval: 0,
    };
    // Animation stats printing timer
    animationStatsTimer = null;
    constructor(canvas, settings) {
        if (!ENABLE_INSPECTOR)
            return;
        if (!settings) {
            throw new Error('settings is required');
        }
        // Initialize performance monitoring settings with defaults
        this.performanceSettings = {
            enablePerformanceMonitoring: settings.inspectorOptions?.enablePerformanceMonitoring ?? false,
            excessiveCallThreshold: settings.inspectorOptions?.excessiveCallThreshold ?? 100,
            resetInterval: settings.inspectorOptions?.resetInterval ?? 5000,
            enableAnimationMonitoring: settings.inspectorOptions?.enableAnimationMonitoring ?? false,
            maxAnimationHistory: settings.inspectorOptions?.maxAnimationHistory ?? 1000,
            animationStatsInterval: settings.inspectorOptions?.animationStatsInterval ?? 0,
        };
        this.canvas = canvas;
        // The overlay mirrors the app in logical pixels, scaled to the canvas.
        // App size and pixel ratio are fixed at construction, so this is set
        // once; setRootPosition only tracks where the canvas sits on the page.
        const root = (this.root = document.createElement('div'));
        const style = root.style;
        const scale = settings.deviceLogicalPixelRatio;
        root.id = 'root';
        style.width = `${Math.ceil(settings.appWidth)}px`;
        style.height = `${Math.ceil(settings.appHeight)}px`;
        style.position = 'absolute';
        style.transformOrigin = '0 0 0';
        style.transform = `scale(${scale}, ${scale})`;
        style.overflow = 'hidden';
        style.zIndex = '65534';
        this.setRootPosition();
        document.body.appendChild(root);
        //listen for changes on canvas
        this.mutationObserver = new MutationObserver(this.setRootPosition.bind(this));
        this.mutationObserver.observe(canvas, {
            attributes: true,
            childList: false,
            subtree: false,
        });
        // Create a ResizeObserver to watch for changes in the element's size
        this.resizeObserver = new ResizeObserver(this.setRootPosition.bind(this));
        this.resizeObserver.observe(canvas);
        //listen for changes on window
        window.addEventListener('resize', this.boundSetRootPosition);
        // Start animation stats timer if enabled
        this.startAnimationStatsTimer();
        console.warn('Inspector is enabled, this will impact performance');
    }
    /**
     * Track setter calls for performance monitoring
     * Only active when Inspector is loaded
     */
    trackSetterCall(nodeId, setterName) {
        if (!this.performanceSettings.enablePerformanceMonitoring) {
            return;
        }
        const key = `${nodeId}_${setterName}`;
        const now = Date.now();
        const existing = Inspector.setterCallCount.get(key);
        if (!existing) {
            Inspector.setterCallCount.set(key, { count: 1, lastReset: now, nodeId });
            return;
        }
        // Reset counter if enough time has passed
        if (now - existing.lastReset > this.performanceSettings.resetInterval) {
            existing.count = 1;
            existing.lastReset = now;
            return;
        }
        existing.count++;
        // Log if threshold exceeded
        if (existing.count === this.performanceSettings.excessiveCallThreshold) {
            console.warn(`🚨 Inspector Performance Warning: Setter '${setterName}' called ${existing.count} times in ${this.performanceSettings.resetInterval}ms on node ${nodeId}`);
        }
        else if (existing.count > this.performanceSettings.excessiveCallThreshold &&
            existing.count % 50 === 0) {
            console.warn(`🚨 Inspector Performance Warning: Setter '${setterName}' called ${existing.count} times in ${this.performanceSettings.resetInterval}ms on node ${nodeId} (continuing...)`);
        }
    }
    /**
     * Get current performance monitoring statistics
     */
    static getPerformanceStats() {
        const stats = [];
        const now = Date.now();
        Inspector.setterCallCount.forEach((data, key) => {
            const parts = key.split('_');
            const nodeIdStr = parts[0];
            const setterName = parts[1];
            if (nodeIdStr && setterName) {
                const timeWindow = now - data.lastReset;
                stats.push({
                    nodeId: parseInt(nodeIdStr, 10),
                    setterName,
                    count: data.count,
                    timeWindow,
                });
            }
        });
        return stats.sort((a, b) => b.count - a.count);
    }
    /**
     * Clear performance monitoring statistics
     */
    static clearPerformanceStats() {
        Inspector.setterCallCount.clear();
    }
    /**
     * Generate a unique animation ID
     */
    static generateAnimationId() {
        return `anim_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
    /**
     * Wrap animation controller with monitoring capabilities
     */
    wrapAnimationController(controller, nodeId, props, settings, div) {
        if (!this.performanceSettings.enableAnimationMonitoring) {
            // Just add the basic DOM animation without tracking
            const originalStart = controller.start.bind(controller);
            controller.start = () => {
                this.animateNode(div, props, settings);
                return originalStart();
            };
            return controller;
        }
        const animationId = Inspector.generateAnimationId();
        // Create wrapper controller
        const wrappedController = {
            start: () => {
                this.trackAnimationStart(animationId, nodeId, props, settings, controller);
                this.animateNode(div, props, settings);
                return controller.start();
            },
            stop: () => {
                this.trackAnimationEnd(animationId, 'stopped');
                return controller.stop();
            },
            pause: () => {
                this.updateAnimationState(animationId, 'paused');
                return controller.pause();
            },
            restore: () => {
                this.trackAnimationEnd(animationId, 'cancelled');
                return controller.restore();
            },
            waitUntilStopped: () => {
                return controller.waitUntilStopped().then(() => {
                    this.trackAnimationEnd(animationId, 'finished');
                });
            },
            get state() {
                return controller.state;
            },
        };
        controller.waitUntilStopped().then(() => {
            this.trackAnimationEnd(animationId, 'finished');
        });
        return wrappedController;
    }
    /**
     * Track animation start
     */
    trackAnimationStart(animationId, nodeId, props, settings, controller) {
        const startTime = Date.now();
        Inspector.activeAnimations.set(animationId, {
            nodeId,
            animationId,
            startTime,
            props,
            settings,
            controller,
            state: 'scheduled',
        });
    }
    /**
     * Update animation state
     */
    updateAnimationState(animationId, state) {
        const animation = Inspector.activeAnimations.get(animationId);
        if (animation) {
            animation.state = state;
        }
    }
    /**
     * Track animation end
     */
    trackAnimationEnd(animationId, completionType) {
        const animation = Inspector.activeAnimations.get(animationId);
        if (!animation)
            return;
        const endTime = Date.now();
        const actualDuration = endTime - animation.startTime;
        const expectedDuration = animation.settings.duration || 1000;
        // Move to history
        Inspector.animationHistory.unshift({
            nodeId: animation.nodeId,
            animationId: animation.animationId,
            startTime: animation.startTime,
            endTime,
            duration: expectedDuration,
            actualDuration,
            props: animation.props,
            settings: animation.settings,
            completionType,
        });
        // Limit history size for performance
        if (Inspector.animationHistory.length >
            this.performanceSettings.maxAnimationHistory) {
            Inspector.animationHistory.splice(this.performanceSettings.maxAnimationHistory);
        }
        // Remove from active animations
        Inspector.activeAnimations.delete(animationId);
    }
    /**
     * Get currently active animations
     */
    static getActiveAnimations() {
        const now = Date.now();
        const activeAnimations = [];
        Inspector.activeAnimations.forEach((animation) => {
            activeAnimations.push({
                nodeId: animation.nodeId,
                animationId: animation.animationId,
                startTime: animation.startTime,
                duration: animation.settings.duration || 1000,
                elapsedTime: now - animation.startTime,
                props: animation.props,
                settings: animation.settings,
                state: animation.state,
            });
        });
        return activeAnimations.sort((a, b) => b.startTime - a.startTime);
    }
    /**
     * Get animation statistics
     */
    static getAnimationStats() {
        const totalAnimations = Inspector.animationHistory.length;
        const activeCount = Inspector.activeAnimations.size;
        // Calculate average duration from finished animations only
        const finishedAnimations = Inspector.animationHistory.filter((anim) => anim.completionType === 'finished');
        const averageDuration = finishedAnimations.length > 0
            ? finishedAnimations.reduce((sum, anim) => sum + anim.actualDuration, 0) / finishedAnimations.length
            : 0;
        return {
            totalAnimations,
            activeCount,
            averageDuration,
        };
    }
    /**
     * Clear animation monitoring data
     */
    static clearAnimationStats() {
        Inspector.activeAnimations.clear();
        Inspector.animationHistory.length = 0;
    }
    /**
     * Start the animation stats timer if enabled
     */
    startAnimationStatsTimer() {
        console.log(`Starting animation stats timer with interval: ${this.performanceSettings.animationStatsInterval} seconds`);
        if (this.performanceSettings.animationStatsInterval > 0) {
            this.animationStatsTimer = setInterval(() => {
                this.printAnimationStats();
            }, this.performanceSettings.animationStatsInterval * 1000);
        }
    }
    /**
     * Stop the animation stats timer
     */
    stopAnimationStatsTimer() {
        if (this.animationStatsTimer) {
            clearInterval(this.animationStatsTimer);
            this.animationStatsTimer = null;
        }
    }
    /**
     * Print current animation statistics to console
     */
    printAnimationStats() {
        const stats = Inspector.getAnimationStats();
        console.log(`🎬 Animation Stats: ${stats.activeCount} active, ${stats.totalAnimations} completed, ${Math.round(stats.averageDuration)}ms avg duration`);
    }
    setRootPosition() {
        if (this.root === null || this.canvas === null) {
            return;
        }
        // get the world position of the canvas object, so we can match the inspector to it
        const rect = this.canvas.getBoundingClientRect();
        const top = document.documentElement.scrollTop + rect.top;
        const left = document.documentElement.scrollLeft + rect.left;
        this.root.style.left = `${left}px`;
        this.root.style.top = `${top}px`;
    }
    createDiv(id, properties) {
        // Use a custom element tag when the node carries a componentName so that
        // Chrome DevTools' Elements panel shows the framework component name
        // instead of a generic <div>.
        const componentName = properties.componentName;
        let el;
        if (componentName) {
            const tagName = toCustomElementTag(componentName);
            ensureCustomElement(tagName);
            el = document.createElement(tagName);
            // Store the original PascalCase name as a readable attribute.
            // el.setAttribute('data-component', componentName);
        }
        else {
            el = document.createElement('div');
        }
        el.style.position = 'absolute';
        el.id = id.toString();
        // set initial properties
        for (const key in properties) {
            this.updateNodeProperty(el, 
            // really typescript? really?
            key, properties[key], properties);
        }
        return el;
    }
    createNodes(node) {
        if (this.root === null) {
            return false;
        }
        const div = this.root.querySelector(`[id="${node.id}"]`);
        if (div === null && node instanceof CoreTextNode) {
            this.createTextNode(node);
        }
        else if (div === null && node instanceof CoreNode) {
            this.createNode(node);
        }
        for (const child of node.children) {
            this.createNodes(child);
        }
        return true;
    }
    createNode(node) {
        const div = this.createDiv(node.id, node.props);
        div.node = node;
        node.div = div;
        node.on('inViewport', () => div.setAttribute('state', 'inViewport'));
        node.on('outOfViewport', () => div.setAttribute('state', 'outOfViewport'));
        // Monitor only relevant properties by trapping with selective assignment
        return this.createProxy(node, div);
    }
    createTextNode(node) {
        // CoreTextNode carries two prop bags:
        //   - `node.props` (inherited CoreNodeProps): x, y, w, h, mount*, alpha…
        //   - `node.textProps` (private): text, fontSize, fontFamily, lineHeight…
        // The mirror div needs both, so we merge them for the initial paint.
        // Without `node.props` the div would have no left/top and render at (0,0)
        // regardless of where the canvas drew the text.
        // eslint-disable-next-line
        // @ts-ignore - textProps is a private property and keeping it that way
        // but we need it from the inspector to set the initial properties on the div element
        const mergedProps = {
            ...node.props,
            ...node.textProps,
        };
        const div = this.createDiv(node.id, mergedProps);
        div.node = node;
        node.div = div;
        return this.createProxy(node, div);
    }
    createProxy(node, div) {
        // Store texture event listeners for cleanup
        const textureListeners = new Map();
        const coreNodeListeners = new Map();
        const setupCoreNodeListeners = (coreNode) => {
            const onLoaded = () => {
                this.updateTextNodeDimensions(div, coreNode);
            };
            coreNode.on('loaded', onLoaded);
            coreNodeListeners.set(coreNode, { onLoaded });
        };
        // Helper function to setup texture event listeners
        const setupTextureListeners = (texture) => {
            // Clean up existing listeners first
            textureListeners.forEach((listeners, oldTexture) => {
                oldTexture.off('loaded', listeners.onLoaded);
                oldTexture.off('failed', listeners.onFailed);
                oldTexture.off('freed', listeners.onFreed);
            });
            textureListeners.clear();
            // Setup new listeners if texture exists
            if (texture) {
                // Initialize metrics if not exists
                if (!this.textureMetrics.has(texture)) {
                    this.textureMetrics.set(texture, {
                        previousState: texture.state,
                        loadedCount: 0,
                        failedCount: 0,
                        freedCount: 0,
                    });
                }
                const onLoaded = () => {
                    const metrics = this.textureMetrics.get(texture);
                    if (metrics) {
                        metrics.previousState =
                            metrics.previousState !== texture.state
                                ? metrics.previousState
                                : 'loading';
                        metrics.loadedCount++;
                    }
                    this.updateTextureAttributes(div, texture);
                };
                const onFailed = () => {
                    const metrics = this.textureMetrics.get(texture);
                    if (metrics) {
                        metrics.previousState =
                            metrics.previousState !== texture.state
                                ? metrics.previousState
                                : 'loading';
                        metrics.failedCount++;
                    }
                    this.updateTextureAttributes(div, texture);
                };
                const onFreed = () => {
                    const metrics = this.textureMetrics.get(texture);
                    if (metrics) {
                        metrics.previousState =
                            metrics.previousState !== texture.state
                                ? metrics.previousState
                                : texture.state;
                        metrics.freedCount++;
                    }
                    this.updateTextureAttributes(div, texture);
                };
                texture.on('loaded', onLoaded);
                texture.on('failed', onFailed);
                texture.on('freed', onFreed);
                textureListeners.set(texture, { onLoaded, onFailed, onFreed });
            }
        };
        // Define traps for each property in knownProperties
        knownProperties.forEach((property) => {
            // Walk the entire prototype chain. CoreTextNode extends CoreNode, so
            // properties like x / y / w / h / mountX / mountY are defined on
            // CoreNode.prototype — two hops up from a CoreTextNode instance. A
            // single-level lookup (the previous behavior) returned undefined for
            // those props on text nodes and skipped installing the trap, which
            // meant updates to those props never reached the mirror div.
            let originalProp = Object.getOwnPropertyDescriptor(node, property);
            let proto = Object.getPrototypeOf(node);
            while (originalProp === undefined && proto !== null) {
                originalProp = Object.getOwnPropertyDescriptor(proto, property);
                proto = Object.getPrototypeOf(proto);
            }
            if (originalProp === undefined) {
                return;
            }
            if (property === 'text') {
                setupCoreNodeListeners(node);
            }
            Object.defineProperty(node, property, {
                get() {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                    return originalProp?.get?.call(node);
                },
                set: (value) => {
                    // Track setter call for performance monitoring
                    this.trackSetterCall(node.id, property);
                    originalProp?.set?.call(node, value);
                    this.updateNodeProperty(div, property, value, node.props);
                    // Setup texture event listeners if this is a texture property
                    if (property === 'texture') {
                        const textureValue = value && typeof value === 'object' && 'state' in value
                            ? value
                            : null;
                        setupTextureListeners(textureValue);
                    }
                },
                configurable: true,
                enumerable: true,
            });
        });
        const originalDestroy = node.destroy;
        Object.defineProperty(node, 'destroy', {
            value: (isChild = false) => {
                // Clean up texture event listeners and metrics
                textureListeners.forEach((listeners, texture) => {
                    texture.off('loaded', listeners.onLoaded);
                    texture.off('failed', listeners.onFailed);
                    texture.off('freed', listeners.onFreed);
                    // Clean up metrics for this texture
                    this.textureMetrics.delete(texture);
                });
                textureListeners.clear();
                coreNodeListeners.forEach((listeners, coreNode) => {
                    coreNode.off('loaded', listeners.onLoaded);
                });
                coreNodeListeners.clear();
                // Animations still running when the node goes away never emit
                // `stopped`, so their entry — and the controller it holds — would stay
                // in the static activeAnimations map for the lifetime of the page.
                Inspector.activeAnimations.forEach((animation, animationId) => {
                    if (animation.nodeId === node.id) {
                        this.trackAnimationEnd(animationId, 'cancelled');
                    }
                });
                this.destroyNode(node);
                originalDestroy.call(node, isChild);
            },
            configurable: true,
        });
        const originalAnimate = node.animate;
        Object.defineProperty(node, 'animate', {
            value: (props, settings) => {
                const animationController = originalAnimate.call(node, props, settings);
                // Wrap animation controller with monitoring
                return this.wrapAnimationController(animationController, node.id, props, settings, div);
            },
            configurable: true,
        });
        return node;
    }
    updateTextNodeDimensions(div, node) {
        const textMetrics = node.renderInfo;
        if (textMetrics) {
            div.style.width = `${textMetrics.width}px`;
            div.style.height = `${textMetrics.height}px`;
        }
        else {
            div.style.removeProperty('width');
            div.style.removeProperty('height');
        }
    }
    updateTextureAttributes(div, texture) {
        // Update texture state
        div.setAttribute('data-texture-state', texture.state);
        // Update texture type
        div.setAttribute('data-texture-type', textureTypeNames[texture.type] || 'unknown');
        // Update texture dimensions if available
        if (texture.dimensions) {
            div.setAttribute('data-texture-width', String(texture.dimensions.w));
            div.setAttribute('data-texture-height', String(texture.dimensions.h));
        }
        else {
            div.removeAttribute('data-texture-width');
            div.removeAttribute('data-texture-height');
        }
        // Update renderable owners count
        div.setAttribute('data-texture-owners', String(texture.renderableOwners.size));
        // Update retry count
        div.setAttribute('data-texture-retry-count', String(texture.retryCount));
        // Update max retry count if available
        if (texture.maxRetryCount !== null) {
            div.setAttribute('data-texture-max-retry-count', String(texture.maxRetryCount));
        }
        else {
            div.removeAttribute('data-texture-max-retry-count');
        }
        // Update metrics if available
        const metrics = this.textureMetrics.get(texture);
        if (metrics) {
            div.setAttribute('data-texture-previous-state', metrics.previousState);
            div.setAttribute('data-texture-loaded-count', String(metrics.loadedCount));
            div.setAttribute('data-texture-failed-count', String(metrics.failedCount));
            div.setAttribute('data-texture-freed-count', String(metrics.freedCount));
        }
        else {
            div.removeAttribute('data-texture-previous-state');
            div.removeAttribute('data-texture-loaded-count');
            div.removeAttribute('data-texture-failed-count');
            div.removeAttribute('data-texture-freed-count');
        }
        // Update error information if present
        if (texture.error) {
            div.setAttribute('data-texture-error', texture.error.code || texture.error.message);
        }
        else {
            div.removeAttribute('data-texture-error');
        }
    }
    destroy() {
        // Stop animation stats timer
        this.stopAnimationStatsTimer();
        // Remove DOM observers
        this.mutationObserver.disconnect();
        this.resizeObserver.disconnect();
        // Remove resize listener
        window.removeEventListener('resize', this.boundSetRootPosition);
        if (this.root && this.root.parentNode) {
            this.root.remove();
        }
        // Clean up animation monitoring data
        Inspector.clearAnimationStats();
    }
    destroyNode(node) {
        // Use the mirror div stored on the node rather than a document-global
        // getElementById, which would collide across multiple renderer/inspector
        // instances sharing one document.
        const div = node.div;
        div?.remove();
    }
    updateNodeProperty(div, property, 
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value, props) {
        if (this.root === null || value === undefined || value === null) {
            return;
        }
        /**
         * Special case for parent property
         */
        if (property === 'parent') {
            // value is the parent CoreNode. Its mirror div is stored on the node
            // itself (see createNode/createTextNode), so use that reference instead
            // of a document-global getElementById — the latter collides across
            // multiple renderer/inspector instances sharing one document.
            //
            // The stage root (the only node with parent === null) is mirrored by
            // `this.root`, the container that is actually attached to the document.
            // createNodes() also makes a plain div for the root node, but that div is
            // never attached, so the root's direct children must be parented to
            // `this.root` instead — otherwise the whole mirror tree ends up detached
            // from the document. This replaces the old `parentId === 1` heuristic.
            const parentNode = value;
            const parentDiv = parentNode.parent === null ? this.root : parentNode.div ?? this.root;
            parentDiv.appendChild(div);
            return;
        }
        // special case for mount changes — mount has no CSS equivalent, but it
        // shifts the node's left/top, so recompute position from the latest props.
        if (property === 'mount' ||
            property === 'mountX' ||
            property === 'mountY') {
            div.style.left = `${props.x - props.w * (props.mountX ?? 0)}px`;
            div.style.top = `${props.y - props.h * (props.mountY ?? 0)}px`;
            return;
        }
        // special case for text
        if (property === 'text') {
            // textContent (not innerHTML): text may contain <, &, etc. which would
            // corrupt the mirror tree or act as an injection vector via innerHTML.
            div.textContent = String(value);
            // Keep DOM text invisible without breaking visibility checks
            // Use very low opacity (0.001) instead of 0 so Playwright still detects it
            div.style.opacity = '0.001';
            div.style.pointerEvents = 'none';
            div.style.userSelect = 'none';
            return;
        }
        // special case for images
        // we're not setting any CSS properties to avoid images getting loaded twice
        // as the renderer will handle the loading of the image. Setting it to `data-src`
        if (property === 'src' && value) {
            div.setAttribute(`data-src`, String(value));
            return;
        }
        // special case for color gradients (normal colors are handled by the stylePropertyMap)
        // FIXME the renderer seems to return the same number for all colors
        // if (gradientColorPropertyMap.includes(property as string)) {
        //   const color = convertColorToRgba(value as number);
        //   div.setAttribute(`data-${property}`, color);
        //   return;
        // }
        // CSS mappable attribute
        if (stylePropertyMap[property]) {
            // Text nodes must always stay at opacity 0.001 — never let alpha updates override it.
            if (property === 'alpha' && div.style.pointerEvents === 'none') {
                return;
            }
            const mappedStyleResponse = stylePropertyMap[property]?.(value);
            if (mappedStyleResponse === null) {
                return;
            }
            if (typeof mappedStyleResponse === 'string') {
                div.style.setProperty(mappedStyleResponse, String(value));
                return;
            }
            if (typeof mappedStyleResponse === 'object') {
                let value = mappedStyleResponse.value;
                if (property === 'x') {
                    const mount = props.mountX;
                    const width = props.w;
                    if (mount) {
                        value = `${parseInt(value) - width * mount}px`;
                    }
                }
                else if (property === 'y') {
                    const mount = props.mountY;
                    const height = props.h;
                    if (mount) {
                        value = `${parseInt(value) - height * mount}px`;
                    }
                }
                div.style.setProperty(mappedStyleResponse.prop, value);
            }
            return;
        }
        // DOM properties
        if (domPropertyMap[property]) {
            const domProperty = domPropertyMap[property];
            if (!domProperty) {
                return;
            }
            div.setAttribute(String(domProperty), String(value));
            return;
        }
        // custom data properties
        if (property === 'data') {
            for (const key in value) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                const keyValue = value[key];
                if (keyValue === undefined) {
                    div.removeAttribute(`data-${key}`);
                }
                else {
                    div.setAttribute(`data-${key}`, String(keyValue));
                }
            }
            return;
        }
        // Component metadata – handled when the element is created in createDiv;
        // re-applied here to support dynamic updates (rare but possible).
        if (property === 'componentName' && value) {
            const tagName = toCustomElementTag(String(value));
            ensureCustomElement(tagName);
            // div.setAttribute('data-component', String(value));
            return;
        }
        if (property === 'componentLocation' && value) {
            // Expose the source path so Chrome DevTools extensions and VS Code's
            // browser debugger can offer "open in editor" functionality.
            // div.setAttribute('data-location', String(value));
            return;
        }
    }
    // simple animation handler
    animateNode(div, props, settings) {
        const { duration = 1000, delay = 0,
        // easing = 'linear',
        // repeat = 0,
        // loop = false,
        // stopMethod = false,
         } = settings;
        const { x, y, w, h, alpha = 1, rotation = 0, scale = 1, color, mountX, mountY, } = props;
        // ignoring loops and repeats for now, as that might be a bit too much for the inspector
        function animate() {
            setTimeout(() => {
                div.style.top = `${y - h * mountY}px`;
                div.style.left = `${x - w * mountX}px`;
                div.style.width = `${w}px`;
                div.style.height = `${h}px`;
                // Text nodes must keep opacity at 0.001 — never override it from animation props.
                if (div.style.pointerEvents !== 'none') {
                    div.style.opacity = `${alpha}`;
                }
                div.style.rotate = `${rotation}rad`;
                div.style.scale = `${scale}`;
                div.style.color = convertColorToRgba(color);
            }, duration);
        }
        setTimeout(animate, delay);
    }
}
//# sourceMappingURL=Inspector.js.map