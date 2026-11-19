import type { FileInfo, FileSystemPort } from '../../../../src/sdk/files.js';
import {
  readBytesFile,
  readTextFile,
  writeBytesFile,
  writeTextFile,
} from './io.js';
import { confinePath, isInside } from './paths.js';
import type { AndroidApp } from './runtime.js';

/**
 * The app's files, cache and external-files directories, and nothing outside
 * them: a path that leaves them, through `..` or through a symbolic link, is
 * refused. A relative path is taken from the documents directory. Reads and
 * writes run off the UI thread. Synchronous to construct, for
 * `fileDirectories`.
 */
export function fileSystem(app: AndroidApp): FileSystemPort {
  const context = app.context;
  const documents = String(context.getFilesDir().getAbsolutePath());
  const cache = String(context.getCacheDir().getAbsolutePath());
  const external = context.getExternalFilesDir(null);
  const roots = [documents, cache];
  if (external) roots.push(String(external.getAbsolutePath()));
  let real: string[] | undefined;
  const canonical = (path: string): string =>
    String(new java.io.File(path).getCanonicalPath());
  const file = (path: string): java.io.File => {
    const resolved = confinePath(path, roots, documents);
    real ??= roots.map(canonical);
    if (!isInside(canonical(resolved), real))
      throw new Error('Path is outside the app directories: ' + path);
    return new java.io.File(resolved);
  };
  const forWriting = (path: string): string => {
    const target = file(path);
    target.getParentFile()?.mkdirs();
    return String(target.getPath());
  };
  const mimeType = (name: string): string | undefined => {
    const dot = name.lastIndexOf('.');
    if (dot < 0) return undefined;
    return (
      android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(
        name.slice(dot + 1).toLowerCase(),
      ) ?? undefined
    );
  };
  return {
    documentDirectory: documents,
    cacheDirectory: cache,
    async readText(path) {
      return readTextFile(String(file(path).getPath()));
    },
    async writeText(path, data) {
      return writeTextFile(forWriting(path), data);
    },
    async readBytes(path) {
      return readBytesFile(String(file(path).getPath()));
    },
    async writeBytes(path, data) {
      return writeBytesFile(forWriting(path), data);
    },
    async exists(path) {
      return file(path).exists();
    },
    async remove(path) {
      const target = file(path);
      if (target.exists() && !target.delete())
        throw new Error('Could not remove ' + path);
    },
    async list(path) {
      const entries = file(path).listFiles();
      const files: FileInfo[] = [];
      for (let i = 0; entries && i < entries.length; i++) {
        const entry = entries[i]!;
        const name = String(entry.getName());
        files.push({
          name,
          path: String(entry.getPath()),
          size: entry.length(),
          mimeType: entry.isDirectory() ? undefined : mimeType(name),
          modified: entry.lastModified(),
        });
      }
      return files;
    },
  };
}
