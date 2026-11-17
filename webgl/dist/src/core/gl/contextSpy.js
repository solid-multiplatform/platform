/**
 * Counts WebGL calls by method name for `enableContextSpy` (1.10
 * ContextSpy). `wrap` builds a plain object with one counting function per
 * method of the context, and wraps every extension object the context
 * hands out, so OES_vertex_array_object calls count too. No Proxy: it
 * arrived in Chrome 49 and the floor is Chrome 38. Values that are not
 * functions (enums, the canvas, the drawing buffer size) are copied once;
 * none changes after creation, since the canvas is sized once. Costs
 * nothing unless enabled.
 */
export class ContextSpy {
    constructor() {
        /** Calls per method name since the last reset. */
        this.data = {};
    }
    reset() {
        this.data = {};
    }
    wrap(target) {
        const source = target;
        const out = {};
        for (const key in source) {
            const value = source[key];
            out[key] =
                typeof value === 'function'
                    ? this.counted(key, target, value)
                    : value;
        }
        return out;
    }
    counted(name, target, fn) {
        return (...args) => {
            const data = this.data;
            data[name] = (data[name] ?? 0) + 1;
            const result = fn.apply(target, args);
            if (name === 'getExtension' &&
                result !== null &&
                typeof result === 'object') {
                return this.wrap(result);
            }
            return result;
        };
    }
}
//# sourceMappingURL=contextSpy.js.map