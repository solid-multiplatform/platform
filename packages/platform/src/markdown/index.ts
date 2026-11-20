/**
 * The Markdown entry point (`@solid-multiplatform/platform/markdown`).
 *
 * `markdown(source)` returns a parsed document and caches it: a chat that
 * scrolls back over the same messages parses nothing. The cache is bounded
 * by entries, and the least recently used entry is evicted first; a
 * streaming message re-parses only its own text, because its source string is
 * a new key.
 */
import { parseMarkdown } from './parse.js';
import type { MarkdownDocument } from './types.js';

export type { Block, Inline, ListItem, MarkdownDocument } from './types.js';
export { inlineText, parseInline, parseMarkdown } from './parse.js';

/** Parsed documents kept at once. A screen shows far fewer than this. */
const CACHE_LIMIT = 512;

const cache = new Map<string, MarkdownDocument>();

/** The parsed document for `source`, parsing it only on a cache miss. */
export function markdown(source: string): MarkdownDocument {
  const hit = cache.get(source);
  if (hit !== undefined) {
    // Re-insert to mark it most recently used (Map keeps insertion order).
    cache.delete(source);
    cache.set(source, hit);
    return hit;
  }
  const document = parseMarkdown(source);
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(source, document);
  return document;
}

/** Entries currently cached; a test or a diagnostics screen reads it. */
export function markdownCacheSize(): number {
  return cache.size;
}

/** Empties the cache (tests, or an app dropping a conversation). */
export function clearMarkdownCache(): void {
  cache.clear();
}
