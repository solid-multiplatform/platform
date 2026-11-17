import { UpdateType } from '../CoreNode.js';
import { normalizeFontMetrics } from './TextLayoutEngine.js';
/**
 * Text nodes parked until their font loads, per font name. Shared by the
 * Canvas and SDF font handlers.
 */
export class FontWaitList {
    lists = new Map();
    /**
     * Start accepting waiters for `name`. An existing list is kept: a failed
     * load attempt leaves its nodes parked there, and replacing the list would
     * strand them so a successful retry could never wake them.
     */
    open(name) {
        if (this.lists.has(name) === false) {
            this.lists.set(name, new Set());
        }
    }
    /** Park `node` until `name` loads. No-op if no load is pending for it. */
    add(name, node) {
        const list = this.lists.get(name);
        if (list !== undefined) {
            list.add(node);
        }
    }
    remove(name, node) {
        const list = this.lists.get(name);
        if (list !== undefined) {
            list.delete(node);
        }
    }
    /** Wake every node parked on `name` and stop accepting waiters for it. */
    wake(name) {
        const list = this.lists.get(name);
        if (list === undefined) {
            return;
        }
        this.lists.delete(name);
        for (const node of list) {
            node.setUpdateType(UpdateType.Local);
        }
    }
}
/** Normalized font metrics per font family and size. */
export class FontMetricsCache {
    cache = new Map();
    get(fontFamily, fontSize) {
        return this.cache.get(fontFamily + '_' + fontSize);
    }
    /** Normalize `metrics` for `fontSize`, cache the result and return it. */
    set(fontFamily, fontSize, metrics) {
        const normalized = normalizeFontMetrics(metrics, fontSize);
        this.cache.set(fontFamily + '_' + fontSize, normalized);
        return normalized;
    }
}
//# sourceMappingURL=FontBookkeeping.js.map