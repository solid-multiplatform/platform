/**
 * The TMDB key is injected at build time by build.mjs from TMDB_API_KEY.
 * With no key the app runs entirely from the bundled sample catalogue.
 */
export const TMDB_API_KEY = '__TMDB_API_KEY__';

export const hasApiKey = () =>
  TMDB_API_KEY.length > 0 && !TMDB_API_KEY.startsWith('__');

/**
 * Whether the scroller logs each gesture (release velocity, target, settle
 * time) to logcat, tag `ScrollDemo`. Injected at build time by build.mjs
 * from SCROLL_DEBUG; on by default — a few lines per gesture, none while
 * idle. The Android release bundle strips `console.*`, so the scroller
 * writes through `android.util.Log` there.
 */
export const SCROLL_DEBUG: boolean = ('__SCROLL_DEBUG__' as string) === 'true';

export const scrollDebug = () => SCROLL_DEBUG;
