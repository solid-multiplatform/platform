import { peekService, withService } from './registry.js';

export interface FileInfo {
  name: string;
  path: string;
  /** Bytes. */
  size: number;
  mimeType?: string;
  /** Unix milliseconds. */
  modified?: number;
}

export interface FileSystemPort {
  /** Directory for user-visible documents. */
  documentDirectory?: string;
  /** Directory for disposable cached files. */
  cacheDirectory?: string;
  readText(path: string): Promise<string>;
  writeText(path: string, data: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  list(path: string): Promise<FileInfo[]>;
}

/** App-owned document/cache directories, when the host exposes them. */
export function fileDirectories(): {
  documents?: string;
  cache?: string;
} {
  const port = peekService('fileSystem');
  return {
    documents: port?.documentDirectory,
    cache: port?.cacheDirectory,
  };
}

export async function readFileText(path: string): Promise<string> {
  return withService('fileSystem', (port) => port.readText(path));
}

export async function writeFileText(path: string, data: string): Promise<void> {
  return withService('fileSystem', (port) => port.writeText(path, data));
}

export async function readFileBytes(path: string): Promise<Uint8Array> {
  return withService('fileSystem', (port) => port.readBytes(path));
}

export async function writeFileBytes(
  path: string,
  data: Uint8Array,
): Promise<void> {
  return withService('fileSystem', (port) => port.writeBytes(path, data));
}

export async function fileExists(path: string): Promise<boolean> {
  return withService('fileSystem', (port) => port.exists(path));
}

export async function removeFile(path: string): Promise<void> {
  return withService('fileSystem', (port) => port.remove(path));
}

export async function listFiles(path: string): Promise<FileInfo[]> {
  return withService('fileSystem', (port) => port.list(path));
}

export interface PickedFile {
  name: string;
  type: string;
  size: number;
  text(): Promise<string>;
  bytes(): Promise<Uint8Array>;
}

export interface FilePickerOptions {
  /** MIME types or extensions, e.g. `image/*,.pdf`. */
  accept?: string;
  multiple?: boolean;
}

export interface FilePickerPort {
  pick(options: FilePickerOptions): Promise<PickedFile[]>;
}

declare module './registry.js' {
  interface ServiceProviders {
    fileSystem: FileSystemPort;
    filePicker: FilePickerPort;
  }
}

export const pickedFileFromWeb = (file: File): PickedFile => ({
  name: file.name,
  type: file.type,
  size: file.size,
  text: () => file.text(),
  bytes: async () => new Uint8Array(await file.arrayBuffer()),
});

/**
 * Open the platform document/image picker through the host's `filePicker`
 * service. Resolves with an empty array when the user cancels. The web host
 * uses a hidden `<input type="file">`; desktop and mobile hosts provide their
 * native picker.
 */
export async function pickFiles(
  options: FilePickerOptions = {},
): Promise<PickedFile[]> {
  return withService('filePicker', (port) => port.pick(options));
}

/**
 * Accept files dropped onto an element. Call from a desktop/web surface that
 * owns its own DOM; the same `PickedFile` shape is returned by `pickFiles`.
 */
export function bindFileDrop(
  target: HTMLElement,
  handler: (files: PickedFile[]) => void,
): () => void {
  const over = (event: DragEvent) => {
    event.preventDefault();
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files ?? []).map(
      pickedFileFromWeb,
    );
    if (files.length) handler(files);
  };
  target.addEventListener('dragover', over);
  target.addEventListener('drop', drop);
  return () => {
    target.removeEventListener('dragover', over);
    target.removeEventListener('drop', drop);
  };
}
