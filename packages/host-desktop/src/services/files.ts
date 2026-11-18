// Files: the app's own directories, the system's file dialogs, and saving a
// file where the user says.
import type {
  DownloadData,
  DownloadPort,
} from '@solid-multiplatform/platform/download';
import type {
  FileInfo,
  FilePickerPort,
  FileSystemPort,
  PickedFile,
} from '@solid-multiplatform/platform/files';
import { readFile, readText } from '../assets.js';
import { blobBytes } from '../globals.js';

const TYPES: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  json: 'application/json',
  xml: 'application/xml',
  pdf: 'application/pdf',
  zip: 'application/zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
};

/** The media type a file name's extension stands for, if it is a known one. */
function typeOf(name: string): string | undefined {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? undefined : TYPES[name.slice(dot + 1).toLowerCase()];
}

/** Promise form of a runtime call that ends in `done(error, result)`. */
function call<T>(
  start: (done: (error: Error | null, result?: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    start((error, result) => {
      if (error !== null) reject(error);
      else resolve(result as T);
    });
  });
}

/** The desktop's file system port: the platform's, plus `stat` and the data directory. */
export interface DesktopFileSystemPort extends FileSystemPort {
  /** Directory for the app's own files, which the user does not see. */
  dataDirectory?: string;
  /** What is at `path`, or undefined when nothing is. */
  stat(path: string): Promise<(FileInfo & { directory: boolean }) | undefined>;
}

/**
 * The app's directories. Paths are absolute and must lie in one of the
 * three directories this port names; the runtime refuses any other, also
 * one that gets out through `..` or a symbolic link.
 */
export function fileSystem(id: string): DesktopFileSystemPort {
  const fs = __solid.fs;
  const dirs = fs.dirs(id);
  const info = (directory: string, entry: SolidFileEntry) => ({
    name: entry.name,
    path: `${directory.replace(/[/\\]$/, '')}/${entry.name}`,
    size: entry.size,
    mimeType: entry.directory ? undefined : typeOf(entry.name),
    modified: entry.modified,
    directory: entry.directory,
  });
  return {
    documentDirectory: dirs.documents,
    cacheDirectory: dirs.cache,
    dataDirectory: dirs.data,
    readText: (path) => call<string>((done) => fs.read(path, true, done)),
    writeText: (path, data) => call<void>((done) => fs.write(path, data, done)),
    readBytes: (path) =>
      call<ArrayBuffer>((done) => fs.read(path, false, done)).then(
        (buffer) => new Uint8Array(buffer),
      ),
    writeBytes: (path, data) =>
      call<void>((done) => fs.write(path, data, done)),
    exists: (path) =>
      call<SolidFileEntry | null>((done) => fs.stat(path, done)).then(
        (entry) => entry !== null,
      ),
    remove: (path) => call<void>((done) => fs.remove(path, done)),
    list: (path) =>
      call<SolidFileEntry[]>((done) => fs.list(path, done)).then((entries) =>
        entries.map((entry) => info(path, entry)),
      ),
    stat: (path) =>
      call<SolidFileEntry | null>((done) => fs.stat(path, done)).then(
        (entry) =>
          entry === null ? undefined : { ...info(path, entry), path },
      ),
  };
}

const GROUPS: Record<string, string[]> = {
  'image/*': ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
  'audio/*': ['mp3', 'wav', 'ogg', 'flac'],
  'video/*': ['mp4', 'webm', 'mkv', 'mov'],
  'text/*': ['txt', 'md', 'csv', 'html', 'css', 'js'],
};

/**
 * The dialog's filters for an `accept` list (`image/*,.pdf`): the file name
 * extensions it stands for, or none at all when part of it names a type
 * this table has no extension for, since leaving that part out would hide
 * files the app accepts.
 */
function filtersFor(accept: string | undefined): string[] {
  const extensions: string[] = [];
  for (const part of (accept ?? '').split(',')) {
    const item = part.trim().toLowerCase();
    if (item === '') continue;
    if (item.startsWith('.')) {
      extensions.push(item.slice(1));
      continue;
    }
    const known =
      GROUPS[item] ?? Object.keys(TYPES).filter((ext) => TYPES[ext] === item);
    if (known.length === 0) return [];
    extensions.push(...known);
  }
  const safe = extensions.filter((ext) => /^[a-z0-9_.-]+$/.test(ext));
  return safe.length === 0 ? [] : ['Accepted files', safe.join(';')];
}

export function filePicker(): FilePickerPort {
  const dialog = __solid.dialog!;
  return {
    async pick(options) {
      const files = await call<{ path: string; size: number }[]>((done) =>
        dialog.open(
          filtersFor(options.accept),
          options.multiple === true,
          done,
        ),
      );
      return files.map(({ path, size }): PickedFile => {
        const name = path.slice(
          Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1,
        );
        return {
          name,
          type: typeOf(name) ?? '',
          size,
          // The user chose this file: it is read wherever it is.
          text: () => readText(path),
          bytes: () => readFile(path).then((buffer) => new Uint8Array(buffer)),
        };
      });
    },
  };
}

function bytesOf(data: DownloadData): string | Uint8Array {
  if (typeof data === 'string' || data instanceof Uint8Array) return data;
  const bytes = blobBytes(data);
  if (bytes === undefined) {
    throw new TypeError(
      'download: the data must be a string, a Uint8Array or a Blob',
    );
  }
  return bytes;
}

/**
 * Saving: the system's save dialog, then the file written where the user
 * chose. Resolves when it is written, or when the user cancels. `saveUrl` is
 * not implemented: fetch the URL and save the bytes.
 */
export function download(): DownloadPort {
  const dialog = __solid.dialog!;
  return {
    async save(data, options) {
      const dot = options.name.lastIndexOf('.');
      const extension = dot === -1 ? '' : options.name.slice(dot + 1);
      const filters = /^[A-Za-z0-9_-]+$/.test(extension)
        ? [`${extension.toUpperCase()} file`, extension]
        : [];
      await call<string | null>((done) =>
        dialog.save(options.name, filters, bytesOf(data), done),
      );
    },
  };
}
