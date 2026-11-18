import type { FontLoadOptions, FontMetrics } from '../../common/types.js';
import { NULL } from '../nodes/NodeFlags.js';
import type { FetchResponseType } from '../../platform/Platform.js';
import {
  createTexture,
  type ImageTexture,
  type ImageTextureProps,
} from '../textures/Texture.js';
import {
  TX_LOADING,
  TX_QUEUED,
  TX_UPLOADED,
  retryDelay,
  type TextureStore,
} from '../textures/TextureStore.js';
import {
  normalizeSdfData,
  startRequest,
  takeSdfPrefetch,
  type PrefetchedSdfFont,
} from './FontPrefetch.js';
import { parseSdfFont, type SdfFont, type SdfFontData } from './sdfFont.js';

/**
 * Retries of a failed atlas description request (1.10's count): it is
 * tried up to four times in all, at the textures' backoff. The atlas image
 * retries as any texture does (`maxRetryCount`).
 */
export const MAX_FONT_LOAD_RETRIES = 3;

/**
 * One loaded or loading font, under every name it was registered with
 * (`names`: its first name, then those of the others no other load held).
 * Its description (`font`) arrives first: text lays out from it. Its atlas
 * (`rec`, a texture record held wanted, referenced and never cleaned up)
 * arrives next: glyphs draw from it once `ready`.
 */
export class FontRecord {
  /** Unique per registry: what layouts are cached under. */
  readonly id: number;
  readonly names: string[];
  readonly atlasUrl: string;
  readonly atlasDataUrl: string;
  readonly metrics: FontMetrics | undefined;
  /** The parsed atlas description; null until it arrives. */
  font: SdfFont | null = null;
  /** The atlas texture's handle, and its record (the op texture id): NULL until made. */
  atlas: ImageTexture | null = null;
  rec = NULL;
  /** The atlas is uploaded: glyphs of this font draw. */
  ready = false;
  /** Why the load failed for good; null otherwise. */
  error: Error | null = null;
  /** Failed atlas description requests. */
  failures = 0;
  readonly promise: Promise<void>;
  resolve!: () => void;
  reject!: (error: Error) => void;
  /** The atlas listeners, kept to be removed. */
  onLoaded: (() => void) | null = null;
  onFailed: ((target: unknown, error: Error) => void) | null = null;

  constructor(id: number, names: string[], options: FontLoadOptions) {
    this.id = id;
    this.names = names;
    this.atlasUrl = options.atlasUrl;
    this.atlasDataUrl = options.atlasDataUrl;
    this.metrics = options.metrics;
    this.promise = new Promise<void>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

/**
 * The renderer's SDF fonts (spec 10.1): `loadFont`, aliases, one load
 * shared by every request for a name in flight, retries, and the atlas as
 * an ordinary texture with `preventCleanup`. What text nodes wait on is
 * TextNodes': it hears every change of a font through `onChange`.
 */
export class FontRegistry {
  /** The platform's fetch (the Renderer); null headless, where a load fails. */
  fetch: ((url: string, type: FetchResponseType) => Promise<unknown>) | null =
    null;
  /** A timer for a retry (the Renderer: the platform's); null: no retry. */
  schedule: ((callback: () => void, ms: number) => void) | null = null;
  /**
   * A font's description arrived, its atlas did, or its load failed for
   * good (`error` set): TextNodes wakes, or tells, the nodes waiting on it.
   */
  onChange: ((font: FontRecord) => void) | null = null;
  /** Fonts loading: the description or the atlas on its way, or a retry to come. */
  pending = 0;

  private readonly textures: TextureStore;
  private readonly byName = new Map<string, FontRecord>();
  private nextId = 1;
  private destroyed = false;

  constructor(textures: TextureStore) {
    this.textures = textures;
  }

  /** The font registered under `name`, loaded or loading; undefined otherwise. */
  get(name: string): FontRecord | undefined {
    return this.byName.get(name);
  }

  /**
   * Load a font under its names (1.10 loadFont): the first name of
   * `fontFamily` keys the load, the others and `aliases` share it. A name
   * loaded already resolves at once, one in flight returns that load's
   * promise; a font whose load failed for good loads again. A later name
   * that another load holds stays with that load (first wins, as for the
   * first name): the font is registered under the others.
   */
  load(options: FontLoadOptions): Promise<void> {
    const family = options.fontFamily;
    const names =
      typeof family === 'string' ? [family] : (family as string[]).slice();
    const aliases = options.aliases;
    if (aliases !== undefined) {
      for (let i = 0; i < aliases.length; i++) {
        names.push(aliases[i]!);
      }
    }
    const primary = names[0]!;
    // Claimed first, so that a prefetch for a font that needs no load is
    // still released (1.10).
    const prefetched = takeSdfPrefetch(primary);
    const byName = this.byName;
    const existing = byName.get(primary);
    if (existing !== undefined) {
      return existing.promise;
    }
    const own: string[] = [];
    const font = new FontRecord(this.nextId++, own, options);
    for (let i = 0; i < names.length; i++) {
      const name = names[i]!;
      if (byName.has(name) === false) {
        byName.set(name, font);
        own.push(name);
      }
    }
    this.pending++;
    this.fetchData(font, prefetched);
    return font.promise;
  }

  /**
   * The renderer is destroyed: nothing a load in flight does changes
   * anything afterwards, and its promise never settles.
   */
  destroy(): void {
    this.destroyed = true;
    this.byName.clear();
    this.pending = 0;
  }

  /**
   * A load of a destroyed registry. Nothing else makes one stale: no
   * callback of a load remains once it failed, and none other replaces it
   * under its names (1.10 settled both of two loads sharing a name).
   */
  private stale(): boolean {
    return this.destroyed;
  }

  private fetchData(
    font: FontRecord,
    prefetched: PrefetchedSdfFont | undefined,
  ): void {
    const data =
      prefetched === undefined
        ? this.request(font)
        : prefetched.data.then((d) => (d !== null ? d : this.request(font)));
    // Parsed in the chain: a description that parsing throws on (a null
    // glyph or kerning entry) fails as a failed request does.
    data
      .then((d) => parseSdfFont(font.names[0]!, d, font.metrics))
      .then(
        (parsed) => {
          this.dataArrived(font, parsed, prefetched);
        },
        (error: Error) => {
          this.dataFailed(font, error);
        },
      );
  }

  /** One request for the atlas description. */
  private request(font: FontRecord): Promise<SdfFontData> {
    const fetch = this.fetch;
    if (fetch === null) {
      return Promise.reject(
        new Error(`No fetch to load the SDF font ${font.names[0]!} with`),
      );
    }
    return startRequest(fetch, font.atlasDataUrl, 'json').then((response) => {
      const data = normalizeSdfData(response);
      if (data === null) {
        throw new Error('Invalid SDF font data format');
      }
      return data;
    });
  }

  private dataFailed(font: FontRecord, error: Error): void {
    if (this.stale() === true) {
      return;
    }
    const failures = font.failures + 1;
    font.failures = failures;
    const schedule = this.schedule;
    if (failures > MAX_FONT_LOAD_RETRIES || schedule === null) {
      this.fail(font, error);
      return;
    }
    console.warn(
      `SDF font "${font.names[0]!}" failed to load (attempt ${failures} of ${
        MAX_FONT_LOAD_RETRIES + 1
      }), retrying.`,
      error,
    );
    // A retry goes back to the network, not to the prefetch.
    schedule(() => {
      if (this.stale() === false) {
        this.fetchData(font, undefined);
      }
    }, retryDelay(failures));
  }

  /**
   * The description arrived, parsed: text lays out from it now, and the
   * atlas loads (the prefetched image when there is one, else its URL).
   */
  private dataArrived(
    font: FontRecord,
    parsed: SdfFont,
    prefetched: PrefetchedSdfFont | undefined,
  ): void {
    if (this.stale() === true) {
      return;
    }
    font.font = parsed;
    this.changed(font);
    if (prefetched === undefined) {
      this.makeAtlas(font, null);
      return;
    }
    prefetched.atlas.then((blob) => {
      if (this.stale() === false) {
        this.makeAtlas(font, blob);
      }
    });
  }

  /**
   * The atlas texture: straight alpha (its channels are distances), cached
   * by its URL whether it came prefetched or not, so two fonts on one atlas
   * share it; referenced, wanted and never cleaned up while the font
   * lives. A prefetched image is tried once: a failure goes back to the
   * network (atlasFailed).
   */
  private makeAtlas(font: FontRecord, blob: Blob | null): void {
    const store = this.textures;
    const atlas =
      blob !== null
        ? createTexture(store, 'ImageTexture', {
            src: blob,
            key: font.atlasUrl,
            premultiplyAlpha: false,
            maxRetryCount: 0,
          })
        : createTexture(store, 'ImageTexture', {
            src: font.atlasUrl,
            key: font.atlasUrl,
            premultiplyAlpha: false,
          });
    const rec = atlas.id;
    font.atlas = atlas;
    font.rec = rec;
    store.ref(rec);
    store.want(rec, true);
    // Queued here, outside any frame: the loader starts it now, as it does
    // a retry, rather than after a drawn frame an idle renderer may never
    // draw.
    if (store.state[rec] === TX_QUEUED) {
      store.onQueued();
    }
    atlas.preventCleanup = true;
    if (store.state[rec] === TX_UPLOADED) {
      this.atlasArrived(font);
      return;
    }
    // Failed for good and still cached (held by a font that has not heard
    // yet, or an image of the same file): taken as heard, so a failed image
    // goes to the URL whichever source this font asked for.
    if (store.failedForGood(rec) === true) {
      this.atlasFailed(font, store.errors[rec] ?? new Error('Atlas failed'));
      return;
    }
    const onLoaded = (): void => {
      this.atlasArrived(font);
    };
    // The handle hears `failed` on every attempt: only the last one counts.
    const onFailed = (_target: unknown, error: Error): void => {
      if (store.failedForGood(rec) === true) {
        this.atlasFailed(font, error);
      }
    };
    font.onLoaded = onLoaded;
    font.onFailed = onFailed;
    atlas.on('loaded', onLoaded);
    atlas.on('failed', onFailed);
  }

  private atlasArrived(font: FontRecord): void {
    this.unlisten(font);
    if (this.stale() === true) {
      return;
    }
    font.ready = true;
    this.pending--;
    font.resolve();
    this.changed(font);
  }

  /**
   * The atlas failed for good: its texture record goes once nothing else
   * holds it, so a later load makes a new one instead of finding this one
   * in the cache. What failed decides, not what the font asked for (the
   * cache hands every font on an atlas the one record): when it was a
   * prefetched image (tried once), the font loads the atlas from its URL
   * at once, as 1.10 dropped a failed atlas for every font, each then
   * retrying from the network; when it was the URL, the font fails. A
   * failed image still held (by another font on it that has not heard the
   * failure yet, or an image of the same file) leaves the cache first, so
   * the URL load makes a new record, which the other fonts on the image
   * share when they hear the failure.
   */
  private atlasFailed(font: FontRecord, error: Error): void {
    this.unlisten(font);
    if (this.stale() === true) {
      return;
    }
    const store = this.textures;
    const rec = font.rec;
    // Read before the record can go: a source that is not a URL (the
    // prefetched Blob).
    const fromImage =
      typeof (store.props[rec] as ImageTextureProps).src !== 'string';
    store.unwant(rec);
    store.unref(rec);
    const held = store.refCount[rec] !== 0 || store.state[rec] === TX_LOADING;
    if (held === false) {
      store.destroy(rec);
    } else if (fromImage === true) {
      const key = store.keys[rec]!;
      if (store.cache.get(key) === rec) {
        store.cache.delete(key);
      }
    }
    font.atlas = null;
    font.rec = NULL;
    if (fromImage === false) {
      this.fail(font, error);
      return;
    }
    this.makeAtlas(font, null);
  }

  /**
   * The load failed for good: its names are free for a new load, its
   * promise rejects, and the nodes waiting on it hear `failed` and keep
   * waiting (a later load of the name wakes them).
   */
  private fail(font: FontRecord, error: Error): void {
    const names = font.names;
    for (let i = 0; i < names.length; i++) {
      if (this.byName.get(names[i]!) === font) {
        this.byName.delete(names[i]!);
      }
    }
    this.pending--;
    font.error = error;
    console.error(`Failed to load SDF font: ${names[0]!}`, error);
    font.reject(error);
    this.changed(font);
  }

  private unlisten(font: FontRecord): void {
    const atlas = font.atlas;
    if (atlas === null || font.onLoaded === null) {
      return;
    }
    atlas.off('loaded', font.onLoaded);
    atlas.off('failed', font.onFailed!);
    font.onLoaded = null;
    font.onFailed = null;
  }

  private changed(font: FontRecord): void {
    const onChange = this.onChange;
    if (onChange !== null) {
      onChange(font);
    }
  }
}
