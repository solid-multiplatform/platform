import { EASE_CUSTOM, EASE_LINEAR, EASE_STEP_END, EASE_STEP_START, resolveEasing, } from '../../common/easing.js';
import { mergeColorProgress } from '../../common/color.js';
import { DIRTY_ALPHA, DIRTY_COLOR, DIRTY_LOCAL, DIRTY_SHADER, NULL, ST_TEXT, } from '../nodes/NodeFlags.js';
import { F_ALPHA, F_H, F_MOUNT_X, F_MOUNT_Y, F_PIVOT_X, F_PIVOT_Y, F_ROTATION, F_SCALE_X, F_SCALE_Y, F_STRIDE, F_W, F_X, F_Y, I_COLOR_BL, I_COLOR_BR, I_COLOR_TL, I_COLOR_TR, I_STATE, I_STRIDE, } from '../nodes/NodeLayout.js';
const f64Track = (field, bits) => ({
    array: 'f64',
    stride: F_STRIDE,
    field,
    bits,
});
const colorTrack = (field) => ({
    array: 'u32',
    stride: I_STRIDE,
    field,
    bits: DIRTY_COLOR,
});
const FAST = {
    x: f64Track(F_X, DIRTY_LOCAL),
    y: f64Track(F_Y, DIRTY_LOCAL),
    w: f64Track(F_W, DIRTY_LOCAL | DIRTY_SHADER),
    h: f64Track(F_H, DIRTY_LOCAL | DIRTY_SHADER),
    alpha: f64Track(F_ALPHA, DIRTY_ALPHA),
    scaleX: f64Track(F_SCALE_X, DIRTY_LOCAL),
    scaleY: f64Track(F_SCALE_Y, DIRTY_LOCAL),
    rotation: f64Track(F_ROTATION, DIRTY_LOCAL),
    mountX: f64Track(F_MOUNT_X, DIRTY_LOCAL),
    mountY: f64Track(F_MOUNT_Y, DIRTY_LOCAL),
    pivotX: f64Track(F_PIVOT_X, DIRTY_LOCAL),
    pivotY: f64Track(F_PIVOT_Y, DIRTY_LOCAL),
    colorTl: colorTrack(I_COLOR_TL),
    colorTr: colorTrack(I_COLOR_TR),
    colorBl: colorTrack(I_COLOR_BL),
    colorBr: colorTrack(I_COLOR_BR),
};
const GROUPS = {
    scale: ['scaleX', 'scaleY'],
    mount: ['mountX', 'mountY'],
    pivot: ['pivotX', 'pivotY'],
    color: ['colorTl', 'colorTr', 'colorBl', 'colorBr'],
    colorTop: ['colorTl', 'colorTr'],
    colorBottom: ['colorBl', 'colorBr'],
    colorLeft: ['colorTl', 'colorBl'],
    colorRight: ['colorTr', 'colorBr'],
};
/**
 * A track's entries in `Animation.ints` and in `Animation.refs`, TRACK of
 * each from `i * TRACK`. In `ints`: a fast track's dirty bits, its buffer's
 * stride and its field (its slot is `id * stride + field`), and 1 when the
 * track blends as a colour. In `refs`: a fast track's store buffer and the
 * buffer's name in the store (`rebind` re-reads it), null for the others;
 * a setter track's object (null for a shaderProps track) and key, null for
 * a fast track.
 */
const TRACK = 4;
const T_BITS = 0;
const T_STRIDE = 1;
const T_FIELD = 2;
const T_COLOR = 3;
const R_ARRAY = 0;
const R_NAME = 1;
const R_OBJECT = 2;
const R_KEY = 3;
/**
 * `Animation.stoppedResolve` from `start()` until a `waitUntilStopped()`
 * call makes the run's promise: a run is under way, nobody waits on it.
 */
const noWaiter = () => { };
/** `Animation.shaderTracks` values. */
const SHADER_TRACK = 1;
const RAW_TRACK = 2;
/**
 * The props of the node's shader, or null: without a shader, or with an
 * object in `node.shader` that is no shader (no `props`), which the scene
 * pass draws with Default and whose tracks skip their writes.
 */
function shaderPropsOf(node) {
    const shader = node.shader;
    if (shader === null) {
        return null;
    }
    const props = shader.props;
    return props === undefined || props === null ? null : props;
}
/** The keys of `sp` that hold a value: an undefined one makes no track. */
function definedCount(sp) {
    let n = 0;
    for (const k in sp) {
        if (sp[k] !== undefined) {
            n++;
        }
    }
    return n;
}
/**
 * The props a shader's type declares colours (AdvancedProp `color`), from
 * the registry's record on the shader; null for an object that has none.
 */
function colorPropsOf(shader) {
    const rec = shader._rec;
    if (rec === undefined || rec === null) {
        return null;
    }
    const colors = rec.colors;
    return colors === undefined ? null : colors;
}
/**
 * One animation: the controller object plus its tracks. Tracks are parallel
 * arrays so `step` allocates nothing, four of them (`starts`, `targets`,
 * `ints` and `refs`) so that starting an animation allocates little. A
 * "fast" track writes the prop's slot
 * in a store buffer (`id * stride + field`) and marks dirty bits; a "setter" track writes `object[key]` through a
 * setter (zIndex, text w/h); a shaderProps track writes through the
 * accessors of the node's current shader.
 */
export class Animation {
    constructor(manager, node, props, settings) {
        this.state = 'stopped';
        this.progress = 0;
        /**
         * Whether `starts`/`targets` are currently swapped relative to their
         * construction-time orientation (toggled by `reverse()`). `stop()` uses
         * this to always leave a stopped animation resting in its original,
         * forward orientation.
         */
        this.reversed = false;
        /**
         * How `ease` evaluates the easing (EASE_*, common/easing.ts): a built-in
         * one in place, a custom TimingFunction through `timing`.
         */
        this.easeKind = EASE_CUSTOM;
        /** A cubic bezier's coefficients, x(t) and y(t) (`EasingCurve`). */
        this.xa = 0;
        this.xb = 0;
        this.xc = 0;
        this.ya = 0;
        this.yb = 0;
        this.yc = 0;
        /**
         * The eased progress the next `write` applies. `ease` writes it and
         * `write` reads it, and `progress`, from the instance: a double passed to
         * or returned from a call V8 does not inline is boxed, a heap number per
         * animation per frame each.
         */
        this.eased = 0;
        this.lastRunTime = 0;
        /** Position in the manager's active list, -1 when inactive. */
        this.index = -1;
        /**
         * The manager's frame counter as of this animation's last `step()` this
         * frame, -1 when never stepped. Lets the manager's loop skip an animation
         * a re-entrant unregister already moved into an index it has not visited
         * yet this frame, so it is never stepped twice in one frame.
         */
        this.stepFrame = -1;
        /**
         * The next step is the run's first: `start()` (from stopped or paused)
         * or `retarget()` armed it, and `step` limits it to one frame.
         */
        this.firstStep = false;
        /**
         * A RAW_TRACK's target is not a number (a radius array, a string) and
         * cannot be interpolated: the track writes its raw target when the run
         * ends and its raw start at progress 0 (restore()), nothing in between
         * (1.10 wrote NaN in between). Null without such a track.
         */
        this.rawStarts = null;
        this.rawTargets = null;
        /**
         * Null while stopped; from `start()` until `stop()`, `noWaiter` or the
         * resolve of the run's promise. The promise is made at the run's first
         * `waitUntilStopped()` call, not at `start()`: most runs have no waiter.
         */
        this.stoppedResolve = null;
        this.stoppedPromise = null;
        this.manager = manager;
        this.node = node;
        this.duration = settings.duration ?? 0;
        this.delay = settings.delay ?? 0;
        this.delayFor = this.delay;
        this.loop = settings.loop ?? false;
        this.repeat = settings.repeat ?? 0;
        this.repeatDelay = settings.repeatDelay ?? 0;
        // `repeat` is the TOTAL number of plays (0, 1 or unset all play once;
        // matches 1.10's own type doc, "Number of times to play", and Solid's
        // DOM renderer). `repeatsLeft` counts additional plays beyond the first.
        this.repeatsTotal = (this.repeat > 1 ? this.repeat : 1) - 1;
        this.repeatsLeft = this.repeatsTotal;
        this.stopMethod = settings.stopMethod ?? false;
        this.reverses = this.stopMethod === 'reverse';
        const easing = settings.easing ?? 'linear';
        if (typeof easing === 'string') {
            this.timing = null;
            this.setBuiltInEasing(easing);
        }
        else {
            this.timing = easing;
        }
        const adaptiveDuration = settings.adaptiveDuration ?? false;
        this.lastRunTime = adaptiveDuration === true ? manager.clock() : 0;
        // Pass 1: count tracks. The shaderProps tracks start from the node's
        // shader props as the animation is made; without any, there are none.
        const current = shaderPropsOf(node);
        let count = 0;
        let shaderCount = 0;
        for (const key in props) {
            if (key === 'shaderProps') {
                if (current !== null) {
                    shaderCount = definedCount(props[key]);
                }
                count += shaderCount;
                continue;
            }
            const group = GROUPS[key];
            count += group === undefined ? 1 : group.length;
        }
        this.count = count;
        this.starts = new Float64Array(count);
        this.targets = new Float64Array(count);
        this.ints = new Uint16Array(count * TRACK);
        this.refs = new Array(count * TRACK);
        this.shaderTracks = shaderCount === 0 ? null : new Uint8Array(count);
        // Pass 2: fill tracks.
        let i = 0;
        const store = node.renderer.nodes;
        this.gen = store.generation;
        const isText = node.id !== NULL &&
            (store.u32[node.id * I_STRIDE + I_STATE] & ST_TEXT) !== 0;
        for (const key in props) {
            if (key === 'shaderProps') {
                if (current !== null) {
                    i = this.fillShaderTracks(i, current, props[key], colorPropsOf(node.shader));
                }
                continue;
            }
            const value = props[key];
            const group = GROUPS[key];
            if (group === undefined) {
                this.fillTrack(i++, store, key, value, isText);
            }
            else {
                for (let g = 0; g < group.length; g++) {
                    this.fillTrack(i++, store, group[g], value, isText);
                }
            }
        }
    }
    /**
     * A built-in easing by name, for `ease` to evaluate in place: its kind
     * and a cubic bezier's coefficients, resolved as getTimingFunction
     * resolves them (common/easing.ts: a built-in name from its table, a
     * cubic-bezier string from a bounded cache, parsed on a miss). A name
     * that resolves to nothing (warned there) eases linearly, as
     * getTimingFunction falls back.
     */
    setBuiltInEasing(name) {
        const curve = resolveEasing(name);
        if (curve === null) {
            this.easeKind = EASE_LINEAR;
            return;
        }
        this.easeKind = curve.kind;
        this.xa = curve.xa;
        this.xb = curve.xb;
        this.xc = curve.xc;
        this.ya = curve.ya;
        this.yb = curve.yb;
        this.yc = curve.yc;
    }
    fillTrack(i, store, key, value, isText) {
        const fast = FAST[key];
        const useFast = fast !== undefined && !(isText === true && (key === 'w' || key === 'h'));
        if (useFast === true) {
            const arr = store[fast.array];
            const o = i * TRACK;
            const ints = this.ints;
            const refs = this.refs;
            refs[o + R_ARRAY] = arr;
            refs[o + R_NAME] = fast.array;
            refs[o + R_OBJECT] = null;
            refs[o + R_KEY] = null;
            ints[o + T_STRIDE] = fast.stride;
            ints[o + T_FIELD] = fast.field;
            ints[o + T_BITS] = fast.bits;
            ints[o + T_COLOR] = key.indexOf('color') !== -1 ? 1 : 0;
            this.starts[i] = arr[this.node.id * fast.stride + fast.field] || 0;
            this.targets[i] = value;
            return;
        }
        const target = this.node;
        this.setSetterTrack(i, target, key, target[key] || 0, value);
    }
    /**
     * The shaderProps tracks `sp`, from index `i`, starting from `current`
     * (the node's shader props as the animation is made); returns the next
     * index. A number interpolates, as a colour when the prop's name holds
     * `color` (1.10) or its type declares it one (`colorProps`).
     */
    fillShaderTracks(i, current, sp, colorProps) {
        let at = i;
        for (const k in sp) {
            const value = sp[k];
            if (value === undefined) {
                continue;
            }
            const start = current[k];
            if (typeof value !== 'number') {
                this.shaderTracks[at] = RAW_TRACK;
                this.setRawTrack(at++, k, start, value);
                continue;
            }
            this.shaderTracks[at] = SHADER_TRACK;
            // 1.10: an array start (a radius) animates from its first element.
            this.setSetterTrack(at, null, k, (Array.isArray(start) === true
                ? start[0]
                : start) || 0, value);
            if (colorProps !== null && colorProps.indexOf(k) !== -1) {
                this.ints[at * TRACK + T_COLOR] = 1;
            }
            at++;
        }
        return at;
    }
    /**
     * A shaderProps track whose target is not a number. An array start is
     * copied: it is the shader's own array, which an alias write such as
     * `top-left` changes in place.
     */
    setRawTrack(i, key, start, target) {
        if (this.rawStarts === null) {
            this.rawStarts = new Array(this.count);
            this.rawTargets = new Array(this.count);
        }
        this.rawStarts[i] =
            Array.isArray(start) === true ? start.slice() : start;
        this.rawTargets[i] = target;
        this.setSetterTrack(i, null, key, 0, 0);
    }
    /** `target` is null for a shaderProps track (see `shaderTracks`). */
    setSetterTrack(i, target, key, start, value) {
        const o = i * TRACK;
        const refs = this.refs;
        refs[o + R_ARRAY] = null;
        refs[o + R_NAME] = null;
        refs[o + R_OBJECT] = target;
        refs[o + R_KEY] = key;
        this.ints[o + T_BITS] = 0;
        this.ints[o + T_COLOR] = key.indexOf('color') !== -1 ? 1 : 0;
        this.starts[i] = start;
        this.targets[i] = value;
    }
    start() {
        if (this.state !== 'running' && this.state !== 'scheduled') {
            if (this.stoppedResolve === null) {
                this.stoppedResolve = noWaiter;
            }
            this.manager.register(this);
            this.state = 'scheduled';
            this.firstStep = true;
        }
        return this;
    }
    stop() {
        this.manager.unregister(this);
        const resolve = this.stoppedResolve;
        this.stoppedResolve = null;
        this.stoppedPromise = null;
        this.progress = 0;
        this.delayFor = this.delay;
        this.repeatsLeft = this.repeatsTotal;
        // Always rest in the forward orientation: mid-reverse-leg or after an
        // odd number of ping-pong laps, starts/targets are currently swapped
        // (`reversed`), which would otherwise make restore() write the current
        // target instead of the original start, and a later start() replay the
        // reversed leg instead of the forward one. Restoring stopMethod from
        // `reverses` (not just leaving it alone) matters too: a one-shot
        // reverse run's forward leg clears stopMethod when it swaps, so without
        // this an animateProp controller reused (retarget(), never stop()) with
        // a reverse settings object would silently stop reversing.
        if (this.reversed === true) {
            this.reverse();
        }
        this.stopMethod = this.reverses === true ? 'reverse' : false;
        this.state = 'stopped';
        if (resolve !== null) {
            resolve();
        }
        return this;
    }
    pause() {
        this.manager.unregister(this);
        this.state = 'paused';
        return this;
    }
    restore() {
        this.stop();
        this.eased = 0;
        this.write();
        return this;
    }
    waitUntilStopped() {
        if (this.stoppedResolve === null) {
            return Promise.resolve();
        }
        if (this.stoppedPromise === null) {
            this.stoppedPromise = new Promise((resolve) => {
                this.stoppedResolve = resolve;
            });
        }
        return this.stoppedPromise;
    }
    /**
     * Re-read every fast track's array from the store by name, when the store
     * has grown (and replaced every typed array) since the last bind. Setter
     * tracks have no array to rebind (a null R_NAME). Called at the start of
     * `write` and `retarget`, the only places that touch the arrays.
     */
    rebind(store) {
        if (store.generation === this.gen) {
            return;
        }
        const end = this.count * TRACK;
        const refs = this.refs;
        for (let o = 0; o < end; o += TRACK) {
            const name = refs[o + R_NAME];
            if (name !== null) {
                refs[o + R_ARRAY] = store[name];
            }
        }
        this.gen = store.generation;
    }
    /** Re-read every track's start from the current value and set a new target. */
    retarget(target) {
        this.rebind(this.node.renderer.nodes);
        const id = this.node.id;
        const n = this.count;
        const ints = this.ints;
        const refs = this.refs;
        for (let i = 0; i < n; i++) {
            const o = i * TRACK;
            const arr = refs[o + R_ARRAY];
            const object = refs[o + R_OBJECT];
            if (arr !== null) {
                this.starts[i] =
                    arr[id * ints[o + T_STRIDE] + ints[o + T_FIELD]] || 0;
            }
            else if (object !== null) {
                // A setter track re-reads its start. The test is defensive only:
                // retarget serves animateProp, whose one track is a node prop,
                // never a shaderProps track (no object), which would keep its start.
                this.starts[i] = object[refs[o + R_KEY]] || 0;
            }
            this.targets[i] = target;
        }
        // A reused controller (animateProp with the same settings object) must
        // resume in its forward orientation, exactly like stop() guarantees:
        // reused mid-reverse-leg or after an odd number of ping-pong laps,
        // `reversed` and `stopMethod` are left over from BEFORE this retarget
        // and no longer describe the freshly-read starts/targets above. Left
        // alone, a one-shot reverse run would finish this leg and call stop()
        // instead of entering the reverse leg (stopMethod already cleared by
        // the earlier leg), and stop()'s own reversed-swap would then corrupt
        // the very pair just set here, so restore() writes the new target
        // instead of the value at retarget time. Reset all three the same way
        // stop() does; progress and delayFor are the caller's responsibility
        // (animateProp sets progress itself).
        this.reversed = false;
        this.stopMethod = this.reverses === true ? 'reverse' : false;
        this.repeatsLeft = this.repeatsTotal;
        // A new leg, whose start() is a no-op on a running controller.
        this.firstStep = true;
    }
    /** Advance by `dt` ms. Called by the manager. */
    step(dt) {
        let remaining = dt;
        // A run's first step advances one frame at most (`maxFirstStep`). The
        // frame delta runs from the last drawn frame, so it holds the work that
        // started the run: a 46 ms key handler would open a 200 ms animation
        // 23% of the way in. A resume after pause() and a restart after stop()
        // are limited too, for the same reason. Before the delay, which counts
        // from the start as the run does; laps and repeats are not limited.
        if (this.firstStep === true) {
            this.firstStep = false;
            const max = this.manager.maxFirstStep;
            if (remaining > max) {
                remaining = max;
            }
        }
        if (this.delayFor > 0) {
            this.delayFor -= remaining;
            if (this.delayFor >= 0) {
                return;
            }
            remaining = -this.delayFor;
            this.delayFor = 0;
        }
        if (this.state === 'scheduled') {
            this.state = 'running';
        }
        const duration = this.duration;
        if (duration === 0) {
            this.progress = 1;
        }
        else {
            this.progress += remaining / duration;
        }
        let finished = false;
        if (this.progress >= 1) {
            if (this.loop === true) {
                this.progress = this.progress % 1;
                this.delayFor = this.delay;
                // Ping-pong: a looping animation with stopMethod 'reverse' swaps
                // direction at every wrap instead of always playing forward.
                // `reverse()` never clears `stopMethod` here because `this.loop` is
                // true, so this keeps firing on every lap.
                if (this.stopMethod === 'reverse') {
                    this.reverse();
                }
            }
            else {
                this.progress = 1;
                finished = true;
            }
        }
        // Linear, the default, here: a lone animation's step is optimized long
        // before a method it calls once a frame, which boxes the doubles it
        // reads until it is.
        if (this.easeKind === EASE_LINEAR) {
            this.eased = this.progress;
        }
        else {
            this.ease();
        }
        this.write();
        if (finished === false) {
            return;
        }
        if (this.stopMethod === 'reverse') {
            this.reverse();
            this.progress = 0;
            this.delayFor = this.delay;
            return;
        }
        if (this.repeatsLeft > 0) {
            this.repeatsLeft--;
            this.progress = 0;
            this.delayFor = this.repeatDelay;
            if (this.reverses === true) {
                // The forward leg's reverse() above cleared stopMethod (loop is
                // false in this branch); swap the tracks back and restore it so the
                // repeat plays forward then back again, instead of replaying just
                // the reversed leg.
                this.reverse();
                this.stopMethod = 'reverse';
            }
            return;
        }
        this.stop();
    }
    /**
     * `eased` from `progress`, for every easing but linear (`step` applies
     * it): a built-in easing in place, its doubles in locals and fields; a
     * custom TimingFunction through its call, which boxes the progress it
     * takes and the value it returns unless V8 inlines it (an app's own
     * function).
     */
    ease() {
        const kind = this.easeKind;
        const time = this.progress;
        if (kind === EASE_CUSTOM) {
            this.eased = this.timing(time);
            return;
        }
        if (kind === EASE_STEP_START) {
            this.eased = 1;
            return;
        }
        if (kind === EASE_STEP_END) {
            this.eased = time === 1 ? 1 : 0;
            return;
        }
        // A cubic bezier, solved as getTimingFunction's solves it (bezierTiming,
        // common/easing.ts): Newton's method on x(t) = time, bisection where
        // the slope vanishes, then y(t).
        if (time >= 1.0) {
            this.eased = 1;
            return;
        }
        if (time <= 0) {
            this.eased = 0;
            return;
        }
        const xa = this.xa;
        const xb = this.xb;
        const xc = this.xc;
        let t = 0.5;
        let solved = false;
        for (let it = 0; it < 20; it++) {
            const dx = time - t * (t * (t * xa + xb) + xc);
            if (dx > -1e-8 && dx < 1e-8) {
                solved = true;
                break;
            }
            const slope = t * (t * (3 * xa) + 2 * xb) + xc;
            if (slope > -1e-10 && slope < 1e-10) {
                break;
            }
            t += dx / slope;
        }
        if (solved === false) {
            let lo = 0;
            let hi = 1;
            for (let it = 0; it < 20; it++) {
                t = 0.5 * (lo + hi);
                const dx = time - t * (t * (t * xa + xb) + xc);
                if (dx > -1e-8 && dx < 1e-8) {
                    break;
                }
                if (dx < 0) {
                    hi = t;
                }
                else {
                    lo = t;
                }
            }
        }
        this.eased = t * (t * (t * this.ya + this.yb) + this.yc);
    }
    /** Apply `progress` and `eased` to every track. */
    write() {
        // Nothing to write for a destroyed node (e.g. restore() called late): a
        // fast-track write to index -1 and a markDirty(NULL) call are no-ops, a
        // zIndex/w/h setter track guards itself against a NULL id, and a
        // destroyed handle's `shader` reads null. A destroyed handle's id never
        // changes back, so this guard is permanent once tripped.
        if (this.node.id === NULL) {
            return;
        }
        const store = this.node.renderer.nodes;
        this.rebind(store);
        const progress = this.progress;
        const eased = this.eased;
        const id = this.node.id;
        const n = this.count;
        const starts = this.starts;
        const targets = this.targets;
        const ints = this.ints;
        const refs = this.refs;
        const shaderTracks = this.shaderTracks;
        // Read once per write: the node's current shader (see shaderTracks).
        const shaderProps = shaderTracks === null ? null : shaderPropsOf(this.node);
        // Every fast track of this animation targets the same node (`id`), so
        // OR their dirty bits together and mark dirty once instead of once per
        // track.
        let bitsOr = 0;
        for (let i = 0; i < n; i++) {
            const o = i * TRACK;
            const shaderTrack = shaderTracks === null ? 0 : shaderTracks[i];
            if (shaderTrack === RAW_TRACK) {
                // Its ends only.
                if (shaderProps !== null && (progress === 1 || progress === 0)) {
                    shaderProps[refs[o + R_KEY]] =
                        progress === 1 ? this.rawTargets[i] : this.rawStarts[i];
                }
                continue;
            }
            const start = starts[i];
            const target = targets[i];
            let v;
            if (progress === 1) {
                v = target;
            }
            else if (progress === 0) {
                v = start;
            }
            else if (ints[o + T_COLOR] === 1) {
                v = mergeColorProgress(start, target, eased);
            }
            else {
                v = start + (target - start) * eased;
            }
            const arr = refs[o + R_ARRAY];
            if (arr !== null) {
                arr[id * ints[o + T_STRIDE] + ints[o + T_FIELD]] = v;
                bitsOr |= ints[o + T_BITS];
            }
            else if (shaderTrack === SHADER_TRACK) {
                if (shaderProps !== null) {
                    shaderProps[refs[o + R_KEY]] = v;
                }
            }
            else {
                refs[o + R_OBJECT][refs[o + R_KEY]] = v;
            }
        }
        if (bitsOr !== 0) {
            store.markDirty(id, bitsOr);
        }
    }
    reverse() {
        const n = this.count;
        for (let i = 0; i < n; i++) {
            const t = this.starts[i];
            this.starts[i] = this.targets[i];
            this.targets[i] = t;
        }
        const rawStarts = this.rawStarts;
        if (rawStarts !== null) {
            const rawTargets = this.rawTargets;
            for (let i = 0; i < n; i++) {
                const t = rawStarts[i];
                rawStarts[i] = rawTargets[i];
                rawTargets[i] = t;
            }
        }
        this.reversed = !this.reversed;
        if (this.loop === false) {
            this.stopMethod = false;
        }
    }
}
//# sourceMappingURL=Animation.js.map