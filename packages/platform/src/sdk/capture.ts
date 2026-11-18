import { CapabilityError } from './services.js';

export interface CameraOptions {
  facingMode?: 'user' | 'environment';
  /** JPEG quality 0..1 for the web canvas fallback. Defaults to 0.92. */
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
  stop(): void;
}

let cameraPort: CameraPort | undefined;
let microphonePort: MicrophonePort | undefined;

export function setCameraPort(next: CameraPort | undefined): void {
  cameraPort = next;
}

export function setMicrophonePort(next: MicrophonePort | undefined): void {
  microphonePort = next;
}

const mediaDevices = (): MediaDevices | undefined => {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.mediaDevices;
};

/**
 * Capture one photo. Native hosts provide a camera port; the web fallback
 * requests a video stream, draws one frame to a canvas and stops the tracks.
 */
export async function capturePhoto(
  options: CameraOptions = {},
): Promise<CapturedPhoto> {
  if (cameraPort) return cameraPort.capture(options);
  const devices = mediaDevices();
  if (!devices?.getUserMedia || typeof document === 'undefined') {
    throw new CapabilityError('camera');
  }
  const stream = await devices.getUserMedia({
    video: options.facingMode ? { facingMode: options.facingMode } : true,
  });
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) {
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => resolve();
      });
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new CapabilityError('camera');
    context.drawImage(video, 0, 0);
    return {
      dataUrl: canvas.toDataURL('image/jpeg', options.quality ?? 0.92),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

/** Open a microphone stream (recording is app-owned). */
export async function openMicrophone(): Promise<MediaStream> {
  if (microphonePort) return microphonePort.start();
  const devices = mediaDevices();
  if (!devices?.getUserMedia) throw new CapabilityError('microphone');
  return devices.getUserMedia({ audio: true });
}

export function stopMicrophone(stream?: MediaStream): void {
  if (microphonePort) return microphonePort.stop();
  for (const track of stream?.getTracks() ?? []) track.stop();
}
