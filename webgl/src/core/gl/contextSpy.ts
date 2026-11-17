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
  /** Calls per method name since the last reset. */
  data: Record<string, number> = {};

  reset(): void {
    this.data = {};
  }

  wrap<T extends object>(target: T): T {
    const source = target as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key in source) {
      const value = source[key];
      out[key] =
        typeof value === 'function'
          ? this.counted(key, target, value as (...args: unknown[]) => unknown)
          : value;
    }
    return out as unknown as T;
  }

  private counted(
    name: string,
    target: object,
    fn: (...args: unknown[]) => unknown,
  ): (...args: unknown[]) => unknown {
    return (...args: unknown[]): unknown => {
      const data = this.data;
      data[name] = (data[name] ?? 0) + 1;
      const result = fn.apply(target, args);
      if (
        name === 'getExtension' &&
        result !== null &&
        typeof result === 'object'
      ) {
        return this.wrap(result);
      }
      return result;
    };
  }
}
