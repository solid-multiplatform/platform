import type { CoreTextNode } from '../CoreTextNode.js';
import type { FontMetrics, NormalizedFontMetrics } from './TextRenderer.js';
/**
 * Text nodes parked until their font loads, per font name. Shared by the
 * Canvas and SDF font handlers.
 */
export declare class FontWaitList {
    private lists;
    /**
     * Start accepting waiters for `name`. An existing list is kept: a failed
     * load attempt leaves its nodes parked there, and replacing the list would
     * strand them so a successful retry could never wake them.
     */
    open(name: string): void;
    /** Park `node` until `name` loads. No-op if no load is pending for it. */
    add(name: string, node: CoreTextNode): void;
    remove(name: string, node: CoreTextNode): void;
    /** Wake every node parked on `name` and stop accepting waiters for it. */
    wake(name: string): void;
}
/** Normalized font metrics per font family and size. */
export declare class FontMetricsCache {
    private cache;
    get(fontFamily: string, fontSize: number): NormalizedFontMetrics | undefined;
    /** Normalize `metrics` for `fontSize`, cache the result and return it. */
    set(fontFamily: string, fontSize: number, metrics: FontMetrics): NormalizedFontMetrics;
}
