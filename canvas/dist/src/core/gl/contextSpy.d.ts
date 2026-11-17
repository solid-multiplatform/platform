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
export declare class ContextSpy {
    /** Calls per method name since the last reset. */
    data: Record<string, number>;
    reset(): void;
    wrap<T extends object>(target: T): T;
    private counted;
}
