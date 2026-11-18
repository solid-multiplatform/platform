// The app's files: fonts, images and data that ship next to its script, or
// that it names by an http(s) URL.
import { httpBytes } from './services/request.js';
import { decodeUtf8 } from './web/encoding.js';

const remote = (url: string): boolean => /^https?:\/\//i.test(url);

/**
 * The local file a URL names. A path is taken as it is, relative to the app's
 * directory unless absolute; a `file:` URL is decoded. Any other scheme
 * throws.
 */
export function filePath(url: string): string {
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  if (scheme === null) {
    return url.startsWith('/') ? url : `${__solid.appDir}/${url}`;
  }
  const local = /^file:\/\/(?:localhost)?(\/[^?#]*)/i.exec(url);
  if (local === null) {
    throw new Error(
      `The desktop host cannot load ${url}: only files and http(s) URLs are implemented`,
    );
  }
  return decodeURIComponent(local[1]!);
}

export function readFile(url: string): Promise<ArrayBuffer> {
  if (remote(url)) return httpBytes(url);
  return new Promise((resolve, reject) => {
    __solid.readFile(filePath(url), (error, data) => {
      if (error !== null) reject(error);
      else resolve(data!);
    });
  });
}

export function readText(url: string): Promise<string> {
  if (remote(url)) {
    return httpBytes(url).then((body) => {
      const bytes = new Uint8Array(body);
      // A byte order mark is not part of the text.
      const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
      return decodeUtf8(bom ? bytes.subarray(3) : bytes, true);
    });
  }
  return new Promise((resolve, reject) => {
    __solid.readText(filePath(url), (error, text) => {
      if (error !== null) reject(error);
      else resolve(text!);
    });
  });
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** The media type a file's extension stands for; empty when unknown. */
export function mediaType(url: string): string {
  const extension = /\.([a-zA-Z0-9]+)(?:[?#].*)?$/.exec(url);
  return (extension && IMAGE_TYPES[extension[1]!.toLowerCase()]) || '';
}
