import type {
  FileInfo,
  FileSystemPort,
} from '@solid-multiplatform/platform/files';
import { confine } from './paths.js';

const NSDocumentDirectory = 9;
const NSCachesDirectory = 13;
const NSUserDomainMask = 1;

/**
 * The app's own Documents, Caches and temporary directories; no path leaves
 * them. A relative path is under Documents on iOS. tvOS keeps no documents
 * (the system may purge everything an app stores), so there it is under
 * Caches and `documentDirectory` is left out.
 */
export function fileSystem(form: 'phone' | 'tv'): FileSystemPort {
  const directory = (kind: number) =>
    NSSearchPathForDirectoriesInDomains(kind, NSUserDomainMask, true)
      .firstObject;
  const cache = directory(NSCachesDirectory);
  const documents = form === 'tv' ? undefined : directory(NSDocumentDirectory);
  const home = documents ?? cache;
  const roots = [home, cache, NSTemporaryDirectory()];
  const resolve = (path: string) => {
    if (!path.startsWith('/')) return confine(home, path);
    for (const root of roots) {
      try {
        return confine(root, path);
      } catch {
        // Not under this root.
      }
    }
    throw new Error('Path outside the app directories: ' + path);
  };
  const files = () => NSFileManager.defaultManager;
  const prepare = (file: string) =>
    files().createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
      file.slice(0, file.lastIndexOf('/')),
      true,
      null,
    );
  return {
    documentDirectory: documents,
    cacheDirectory: cache,
    async readText(path) {
      return String(
        NSString.stringWithContentsOfFileEncodingError(
          resolve(path),
          NSUTF8StringEncoding,
        ),
      );
    },
    async writeText(path, data) {
      const file = resolve(path);
      prepare(file);
      NSString.stringWithString(data).writeToFileAtomicallyEncodingError(
        file,
        true,
        NSUTF8StringEncoding,
      );
    },
    async readBytes(path) {
      const data = NSData.dataWithContentsOfFile(resolve(path));
      if (!data) throw new Error('Cannot read ' + path);
      // The buffer is the NSData's own memory: copy it out.
      return new Uint8Array(interop.bufferFromData(data)).slice();
    },
    async writeBytes(path, data) {
      const file = resolve(path);
      prepare(file);
      const bytes = data.slice();
      if (
        !NSData.dataWithBytesLength(
          bytes.buffer,
          bytes.byteLength,
        ).writeToFileAtomically(file, true)
      )
        throw new Error('Cannot write ' + path);
    },
    async exists(path) {
      return files().fileExistsAtPath(resolve(path));
    },
    async remove(path) {
      const file = resolve(path);
      if (files().fileExistsAtPath(file)) files().removeItemAtPathError(file);
    },
    async list(path) {
      const folder = resolve(path);
      const names = files().contentsOfDirectoryAtPathError(folder);
      const result: FileInfo[] = [];
      for (let i = 0; names && i < names.count; i++) {
        const name = names.objectAtIndex(i);
        const file = folder + '/' + name;
        const attributes = files().attributesOfItemAtPathError(file);
        const modified: unknown = attributes?.objectForKey(
          NSFileModificationDate,
        );
        result.push({
          name,
          path: file,
          size: Number(attributes?.objectForKey(NSFileSize) ?? 0),
          modified: modified instanceof Date ? modified.getTime() : undefined,
        });
      }
      return result;
    },
  };
}
