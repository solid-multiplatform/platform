import { CapabilityError } from './services.js';

export type DownloadData = string | Blob | Uint8Array;

export interface DownloadOptions {
  /** Suggested file name, including the extension. */
  name: string;
  mimeType?: string;
}

export interface DownloadPort {
  save(data: DownloadData, options: DownloadOptions): Promise<void>;
}

let port: DownloadPort | undefined;

export function setDownloadPort(next: DownloadPort | undefined): void {
  port = next;
}

const mimeFor = (data: DownloadData, explicit?: string): string =>
  explicit ??
  (typeof data === 'string'
    ? 'text/plain;charset=utf-8'
    : 'application/octet-stream');

/**
 * Save a file. Native/desktop hosts provide `DownloadPort` (share sheet or
 * save dialog); the web fallback uses an object URL and a download anchor.
 */
export async function downloadFile(
  data: DownloadData,
  options: DownloadOptions,
): Promise<void> {
  if (port) return port.save(data, options);
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new CapabilityError('download');
  }
  const blob =
    data instanceof Blob
      ? data
      : new Blob([data as BlobPart], {
          type: mimeFor(data, options.mimeType),
        });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = options.name;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
}

export function downloadText(
  text: string,
  name: string,
  mimeType = 'text/plain;charset=utf-8',
): Promise<void> {
  return downloadFile(text, { name, mimeType });
}

export function downloadBytes(
  bytes: Uint8Array,
  name: string,
  mimeType = 'application/octet-stream',
): Promise<void> {
  return downloadFile(bytes, { name, mimeType });
}

/** Trigger a browser download for an existing URL. */
export function downloadUrl(url: string, name?: string): void {
  if (typeof document === 'undefined') throw new CapabilityError('download');
  const anchor = document.createElement('a');
  anchor.href = url;
  if (name) anchor.download = name;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
}
