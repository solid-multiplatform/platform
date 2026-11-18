import { CapabilityError } from './services.js';

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

let port: FileSystemPort | undefined;

export function setFileSystemPort(next: FileSystemPort | undefined): void {
  port = next;
}

const requireFiles = (): FileSystemPort => {
  if (!port) throw new CapabilityError('files');
  return port;
};

/** App-owned document/cache directories, when the host exposes them. */
export function fileDirectories(): {
  documents?: string;
  cache?: string;
} {
  return {
    documents: port?.documentDirectory,
    cache: port?.cacheDirectory,
  };
}

export function readFileText(path: string): Promise<string> {
  return requireFiles().readText(path);
}

export function writeFileText(path: string, data: string): Promise<void> {
  return requireFiles().writeText(path, data);
}

export function readFileBytes(path: string): Promise<Uint8Array> {
  return requireFiles().readBytes(path);
}

export function writeFileBytes(path: string, data: Uint8Array): Promise<void> {
  return requireFiles().writeBytes(path, data);
}

export function fileExists(path: string): Promise<boolean> {
  return requireFiles().exists(path);
}

export function removeFile(path: string): Promise<void> {
  return requireFiles().remove(path);
}

export function listFiles(path: string): Promise<FileInfo[]> {
  return requireFiles().list(path);
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

let pickerPort: FilePickerPort | undefined;

export function setFilePickerPort(next: FilePickerPort | undefined): void {
  pickerPort = next;
}

export const pickedFileFromWeb = (file: File): PickedFile => ({
  name: file.name,
  type: file.type,
  size: file.size,
  text: () => file.text(),
  bytes: async () => new Uint8Array(await file.arrayBuffer()),
});

/**
 * Open the platform document/image picker. Resolves with an empty array when
 * the user cancels. The web fallback uses a hidden `<input type="file">`; the
 * desktop/mobile hosts provide their native picker.
 */
export async function pickFiles(
  options: FilePickerOptions = {},
): Promise<PickedFile[]> {
  if (pickerPort) return pickerPort.pick(options);
  if (typeof document === 'undefined') throw new CapabilityError('filePicker');

  return new Promise<PickedFile[]>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = options.multiple ?? false;
    if (options.accept) input.accept = options.accept;
    input.style.display = 'none';
    const cleanup = () => input.remove();
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []).map(pickedFileFromWeb);
      cleanup();
      resolve(files);
    });
    input.addEventListener('cancel', () => {
      cleanup();
      resolve([]);
    });
    document.body.append(input);
    try {
      input.click();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
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
