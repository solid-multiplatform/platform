import type { CoreTextNode } from '../CoreTextNode.js';
import { UpdateType } from '../CoreNode.js';
import type { FontMetrics, NormalizedFontMetrics } from './TextRenderer.js';
import { normalizeFontMetrics } from './TextLayoutEngine.js';

/**
 * Text nodes parked until their font loads, per font name. Shared by the
 * Canvas and SDF font handlers.
 */
export class FontWaitList {
  private lists = new Map<string, Set<CoreTextNode>>();

  /**
   * Start accepting waiters for `name`. An existing list is kept: a failed
   * load attempt leaves its nodes parked there, and replacing the list would
   * strand them so a successful retry could never wake them.
   */
  open(name: string): void {
    if (this.lists.has(name) === false) {
      this.lists.set(name, new Set());
    }
  }

  /** Park `node` until `name` loads. No-op if no load is pending for it. */
  add(name: string, node: CoreTextNode): void {
    const list = this.lists.get(name);
    if (list !== undefined) {
      list.add(node);
    }
  }

  remove(name: string, node: CoreTextNode): void {
    const list = this.lists.get(name);
    if (list !== undefined) {
      list.delete(node);
    }
  }

  /** Wake every node parked on `name` and stop accepting waiters for it. */
  wake(name: string): void {
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
  private cache = new Map<string, NormalizedFontMetrics>();

  get(fontFamily: string, fontSize: number): NormalizedFontMetrics | undefined {
    return this.cache.get(fontFamily + '_' + fontSize);
  }

  /** Normalize `metrics` for `fontSize`, cache the result and return it. */
  set(
    fontFamily: string,
    fontSize: number,
    metrics: FontMetrics,
  ): NormalizedFontMetrics {
    const normalized = normalizeFontMetrics(metrics, fontSize);
    this.cache.set(fontFamily + '_' + fontSize, normalized);
    return normalized;
  }
}
