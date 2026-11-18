import { CapabilityError, useService, withService } from './registry.js';

export type DownloadData = string | Blob | Uint8Array;

export interface DownloadOptions {
  /** Suggested file name, including the extension. */
  name: string;
  mimeType?: string;
}

export interface DownloadPort {
  save(data: DownloadData, options: DownloadOptions): Promise<void>;
  /** Save a file the host fetches itself, where it can. */
  saveUrl?(url: string, name?: string): void;
}

declare module './registry.js' {
  interface ServiceProviders {
    download: DownloadPort;
  }
}

/**
 * Save a file through the host's `download` service: a share sheet or save
 * dialog on native and desktop hosts, a download anchor on the web.
 */
export async function downloadFile(
  data: DownloadData,
  options: DownloadOptions,
): Promise<void> {
  return withService('download', (port) => port.save(data, options));
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

/** Save the file at an existing URL (a browser download on the web). */
export function downloadUrl(url: string, name?: string): void {
  const port = useService('download');
  if (!port.saveUrl) throw new CapabilityError('download.url');
  port.saveUrl(url, name);
}
