/**
 * The catalogue: TMDB when a key was injected and the network answers, the
 * bundled 40-title sample otherwise. Both produce the same `Title` shape, so
 * every screen is complete on either path.
 */
import sample from './data/sample.json';
import { hasApiKey, TMDB_API_KEY } from './config';

export type RailKey = 'trending' | 'popular' | 'topRated' | 'nowPlaying';

export interface Title {
  id: number;
  title: string;
  year: number;
  rating: number;
  genres: string[];
  overview: string;
  poster: string;
  backdrop: string;
  runtime?: number;
  cast?: string[];
}

export const RAILS: { key: RailKey; label: string }[] = [
  { key: 'trending', label: 'Trending' },
  { key: 'popular', label: 'Popular' },
  { key: 'topRated', label: 'Top rated' },
  { key: 'nowPlaying', label: 'Now playing' },
];

export const SAMPLE = sample as Record<RailKey, Title[]>;

export const ALL_TITLES: Title[] = (() => {
  const seen = new Set<number>();
  const out: Title[] = [];
  for (const rail of RAILS) {
    for (const title of SAMPLE[rail.key] ?? []) {
      if (seen.has(title.id)) continue;
      seen.add(title.id);
      out.push(title);
    }
  }
  return out;
})();

export const byId = (id: number) => ALL_TITLES.find((t) => t.id === id);

export const similarTo = (title: Title, count = 10): Title[] => {
  const scored = ALL_TITLES.filter((other) => other.id !== title.id).map(
    (other) => ({
      other,
      score: other.genres.filter((genre) => title.genres.includes(genre))
        .length,
    }),
  );
  scored.sort((a, b) => b.score - a.score || b.other.rating - a.other.rating);
  return scored.slice(0, count).map((entry) => entry.other);
};

// ---- TMDB

const API = 'https://api.themoviedb.org/3';
const REQUEST_TIMEOUT = 8000;

/** fetch + JSON with a deadline, so a rail never waits on a stalled socket. */
async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`TMDB ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
const IMG = 'https://image.tmdb.org/t/p';

const endpoint: Record<RailKey, string> = {
  trending: '/trending/movie/week',
  popular: '/movie/popular',
  topRated: '/movie/top_rated',
  nowPlaying: '/movie/now_playing',
};

interface TmdbMovie {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  vote_average?: number;
  genre_ids?: number[];
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
}

let genres: Record<number, string> = {};
let genrePromise: Promise<Record<number, string>> | undefined;

async function loadGenres() {
  if (genrePromise) return genrePromise;
  genrePromise = getJson(`${API}/genre/movie/list?api_key=${TMDB_API_KEY}`)
    .then((raw) => {
      const data = raw as { genres?: { id: number; name: string }[] };
      const map: Record<number, string> = {};
      for (const genre of data.genres ?? []) map[genre.id] = genre.name;
      genres = map;
      return map;
    })
    .catch(() => {
      genrePromise = undefined;
      return genres;
    });
  return genrePromise;
}

const posterUrl = (path: string | null | undefined, size: 'w342' | 'w500') =>
  path ? `${IMG}/${size}${path}` : '';
const backdropUrl = (path: string | null | undefined) =>
  path ? `${IMG}/w780${path}` : '';

function normalize(movie: TmdbMovie, map: Record<number, string>): Title {
  return {
    id: movie.id,
    title: movie.title ?? movie.name ?? 'Untitled',
    year: Number((movie.release_date ?? '').slice(0, 4)) || 0,
    rating: Math.round((movie.vote_average ?? 0) * 10) / 10,
    genres: (movie.genre_ids ?? [])
      .map((id) => map[id])
      .filter(Boolean)
      .slice(0, 3),
    overview: movie.overview ?? '',
    poster: posterUrl(movie.poster_path, 'w342'),
    backdrop: backdropUrl(movie.backdrop_path),
    cast: [],
  };
}

/** One rail from TMDB. Rejects on a bad response so the caller can fall back. */
export async function apiRail(key: RailKey): Promise<Title[]> {
  const map = await loadGenres();
  const data = (await getJson(
    `${API}${endpoint[key]}?api_key=${TMDB_API_KEY}&page=1`,
  )) as { results?: TmdbMovie[] };
  const titles = (data.results ?? [])
    .map((movie) => normalize(movie, map))
    .filter((t) => t.poster);
  if (titles.length === 0) throw new Error('TMDB returned no titles');
  return titles;
}

export async function apiDetail(title: Title): Promise<Title> {
  const data = (await getJson(
    `${API}/movie/${title.id}?api_key=${TMDB_API_KEY}&append_to_response=credits`,
  )) as TmdbMovie & {
    runtime?: number;
    genres?: { id: number; name: string }[];
    credits?: { cast?: { name: string }[] };
  };
  return {
    ...title,
    title: data.title ?? title.title,
    year: Number((data.release_date ?? '').slice(0, 4)) || title.year,
    rating: Math.round((data.vote_average ?? title.rating) * 10) / 10,
    genres: (data.genres ?? []).map((genre) => genre.name).slice(0, 3),
    overview: data.overview || title.overview,
    runtime: data.runtime,
    poster: posterUrl(data.poster_path, 'w342') || title.poster,
    backdrop: backdropUrl(data.backdrop_path) || title.backdrop,
    cast: (data.credits?.cast ?? []).slice(0, 8).map((person) => person.name),
  };
}

export const apiEnabled = hasApiKey;
