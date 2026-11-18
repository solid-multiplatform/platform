import { peekService, withService } from './registry.js';

export interface CameraOptions {
  facingMode?: 'user' | 'environment';
  /** JPEG quality 0..1 where the host encodes the photo. Defaults to 0.92. */
  quality?: number;
}

export interface CapturedPhoto {
  /** Data URL (web) or a host file URL. */
  dataUrl: string;
  width: number;
  height: number;
}

export interface CameraPort {
  capture(options: CameraOptions): Promise<CapturedPhoto>;
}

export interface MicrophonePort {
  start(): Promise<MediaStream>;
  /** Stop recording; `stream` is the one `start` resolved with. */
  stop(stream?: MediaStream): void;
}

declare module './registry.js' {
  interface ServiceProviders {
    camera: CameraPort;
    microphone: MicrophonePort;
  }
}

/**
 * Capture one photo through the host's `camera` service. The web host
 * requests a video stream, draws one frame to a canvas and stops the tracks.
 */
export async function capturePhoto(
  options: CameraOptions = {},
): Promise<CapturedPhoto> {
  return withService('camera', (port) => port.capture(options));
}

/** Open a microphone stream (recording is app-owned). */
export async function openMicrophone(): Promise<MediaStream> {
  return withService('microphone', (port) => port.start());
}

export function stopMicrophone(stream?: MediaStream): void {
  const port = peekService('microphone');
  if (port) return port.stop(stream);
  // No service opened this stream, so ending its tracks is all there is.
  for (const track of stream?.getTracks() ?? []) track.stop();
}
