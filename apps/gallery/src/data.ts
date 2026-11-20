/**
 * Sona's library: deterministic albums, no network and no artwork files.
 * Each album carries the two colours its generated cover is built from, so
 * the same scene renders on a TV, a phone and a desktop with nothing to
 * download.
 */
export interface Track {
  title: string;
  seconds: number;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  year: number;
  genre: string;
  /** The two colours of the generated cover, and the gradient's angle. */
  palette: [number, number];
  angle: number;
  tracks: Track[];
}

const track = (title: string, seconds: number): Track => ({ title, seconds });

export const ALBUMS: Album[] = [
  {
    id: 'night-arithmetic',
    title: 'Night Arithmetic',
    artist: 'Mira Vale',
    year: 2026,
    genre: 'Ambient',
    palette: [0x2b3a67ff, 0x0d1220ff],
    angle: 135,
    tracks: [
      track('Carriage Return', 214),
      track('Sixteen Bars of Rain', 188),
      track('Quiet Machine', 246),
      track('Night Arithmetic', 302),
      track('Terminal Bloom', 231),
      track('A Small Theorem', 174),
    ],
  },
  {
    id: 'paper-sun',
    title: 'Paper Sun',
    artist: 'The Long Room',
    year: 2025,
    genre: 'Indie',
    palette: [0xe2603fff, 0x2a1512ff],
    angle: 160,
    tracks: [
      track('Paper Sun', 228),
      track('Second Storey', 197),
      track('Window Seat', 243),
      track('The Long Room', 271),
      track('Half a Mile', 205),
    ],
  },
  {
    id: 'still-life',
    title: 'Still Life',
    artist: 'Oda Rue',
    year: 2024,
    genre: 'Jazz',
    palette: [0x2f5d50ff, 0x0e1a17ff],
    angle: 120,
    tracks: [
      track('Blue Hour', 318),
      track('Still Life', 284),
      track('Table for One', 256),
      track('Late Set', 344),
      track('Encore', 190),
      track('Last Call', 233),
    ],
  },
  {
    id: 'signal-hill',
    title: 'Signal Hill',
    artist: 'June Atlas',
    year: 2026,
    genre: 'Electronic',
    palette: [0x5a4b8cff, 0x141024ff],
    angle: 150,
    tracks: [
      track('Uplink', 201),
      track('Signal Hill', 267),
      track('Relay', 224),
      track('Low Orbit', 289),
      track('Downlink', 176),
    ],
  },
  {
    id: 'golden-hour',
    title: 'Golden Hour',
    artist: 'Nell & the Tide',
    year: 2023,
    genre: 'Folk',
    palette: [0xc9924bff, 0x2a1d10ff],
    angle: 100,
    tracks: [
      track('Golden Hour', 236),
      track('Salt Air', 208),
      track('The Tide', 254),
      track('Harbour Light', 221),
      track('Coming In', 190),
    ],
  },
  {
    id: 'interior',
    title: 'Interior',
    artist: 'Sable Court',
    year: 2025,
    genre: 'Soul',
    palette: [0x7a2f4aff, 0x1a0d13ff],
    angle: 140,
    tracks: [
      track('Interior', 247),
      track('Velvet Hour', 263),
      track('Open Door', 214),
      track('Sable', 292),
      track('Closing Time', 238),
      track('Reprise', 122),
    ],
  },
  {
    id: 'north-of-here',
    title: 'North of Here',
    artist: 'Ivo Marsh',
    year: 2024,
    genre: 'Post-rock',
    palette: [0x3d5a73ff, 0x0b1218ff],
    angle: 170,
    tracks: [
      track('North of Here', 356),
      track('Fjord', 402),
      track('Thin Ice', 287),
      track('The Long Way Down', 431),
      track('Home Light', 312),
    ],
  },
  {
    id: 'small-hours',
    title: 'Small Hours',
    artist: 'Ada Lune',
    year: 2026,
    genre: 'Pop',
    palette: [0xb04a6aff, 0x1c0e14ff],
    angle: 130,
    tracks: [
      track('Small Hours', 198),
      track('Tell Me Twice', 176),
      track('Blue Room', 205),
      track('After the Party', 223),
      track('4 A.M.', 187),
    ],
  },
  {
    id: 'field-notes',
    title: 'Field Notes',
    artist: 'Orin Fell',
    year: 2022,
    genre: 'Americana',
    palette: [0x6b6a3aff, 0x191a0eff],
    angle: 110,
    tracks: [
      track('Field Notes', 249),
      track('Dust Road', 231),
      track('The County Line', 268),
      track('Old Map', 194),
      track('Home Field', 257),
    ],
  },
  {
    id: 'glasshouse',
    title: 'Glasshouse',
    artist: 'Perrin',
    year: 2025,
    genre: 'Electronic',
    palette: [0x3a6f7aff, 0x0c191cff],
    angle: 145,
    tracks: [
      track('Glasshouse', 231),
      track('Condensation', 198),
      track('Green Light', 244),
      track('Panels', 276),
      track('Night Water', 213),
    ],
  },
];

/** Total playing time of an album, in seconds. */
export const albumSeconds = (album: Album): number =>
  album.tracks.reduce((sum, track) => sum + track.seconds, 0);

export const albumById = (id: string): Album | undefined =>
  ALBUMS.find((album) => album.id === id);

/** The three rails on the Library screen; deterministic slices. */
export const RAILS: { title: string; albums: Album[] }[] = [
  { title: 'Recently played', albums: ALBUMS.slice(0, 6) },
  { title: 'New releases', albums: ALBUMS.slice(4, 10) },
  {
    title: 'Late night',
    albums: [ALBUMS[0]!, ALBUMS[8]!, ALBUMS[3]!, ALBUMS[6]!],
  },
];
