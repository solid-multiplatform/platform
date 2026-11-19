import { withService } from './registry.js';

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

export interface RecordingOptions {
  /**
   * The preferred container and codec (`audio/webm`, `audio/mp4`). A host
   * that cannot record it uses its own: read `Recording.mimeType`.
   */
  mimeType?: string;
}

/**
 * A finished recording. A host gives the audio as `blob` (web), as the
 * `path` of a file it wrote (native hosts), or both.
 */
export interface Recording {
  mimeType: string;
  blob?: Blob;
  path?: string;
  durationMs?: number;
}

/** A recording in progress. `stop` ends it and releases the microphone. */
export interface RecordingSession {
  stop(): Promise<Recording>;
}

export interface MicrophonePort {
  start(options: RecordingOptions): Promise<RecordingSession>;
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

/**
 * Start recording from the microphone through the host's `microphone`
 * service. `stop()` on the result ends the recording and resolves with it.
 * The web host records with `MediaRecorder`; a browser app that needs the
 * live stream instead uses `openMicrophoneStream` from the `services/web`
 * entry.
 */
export async function startRecording(
  options: RecordingOptions = {},
): Promise<RecordingSession> {
  return withService('microphone', (port) => port.start(options));
}
