/**
 * The TMDB key is injected at build time by build.mjs from TMDB_API_KEY.
 * With no key the app runs entirely from the bundled sample catalogue.
 */
export const TMDB_API_KEY = '__TMDB_API_KEY__';

export const hasApiKey = () =>
  TMDB_API_KEY.length > 0 && !TMDB_API_KEY.startsWith('__');
