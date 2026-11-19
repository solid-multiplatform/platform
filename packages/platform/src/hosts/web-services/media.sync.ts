/**
 * The browser's media and file services that cannot be loaded on first use.
 * Importing this module runs nothing: every port is an object whose methods
 * read their browser API only when called.
 *
 * Two kinds of service are here:
 *
 * - The ones a browser allows only while it is handling a user gesture
 *   (fullscreen and picture-in-picture, the file picker, downloads, the camera
 *   and microphone prompts). Each method calls its browser API before its
 *   first `await`, so the call happens in the same turn as the app's.
 * - The media session, which the synchronous `configureMediaSession` reads.
 */
import type { AudioPlaybackState, AudioPort } from '../../sdk/audio.js';
import type {
  CameraPort,
  MicrophonePort,
  Recording,
} from '../../sdk/capture.js';
import type { DownloadData, DownloadPort } from '../../sdk/download.js';
import { pickedFileFromWeb, type FilePickerPort } from '../../sdk/files.js';
import type { FullscreenPort, MediaSessionPort } from '../../sdk/media.js';
import { CapabilityError } from '../../sdk/registry.js';

// Missing in older browsers; every operation is then a no-op.
const session = (): MediaSession | undefined =>
  (navigator as { mediaSession?: MediaSession }).mediaSession;

/** The W3C Media Session API. */
export const mediaSession: MediaSessionPort = {
  setMetadata(metadata) {
    const target = session();
    if (target && typeof MediaMetadata === 'function')
      target.metadata = new MediaMetadata(metadata);
  },
  setPlaybackState(state) {
    const target = session();
    if (target) target.playbackState = state;
  },
  setPositionState(state) {
    try {
      session()?.setPositionState?.(state);
    } catch {
      // Ignore invalid position states (e.g. position > duration).
    }
  },
  setActionHandler(action, handler) {
    try {
      // The browser calls a `seekto` handler with `{ seekTime }` in seconds.
      session()?.setActionHandler(
        action,
        (handler as MediaSessionActionHandler | undefined) ?? null,
      );
    } catch {
      // A browser may not support every action.
    }
  },
};

const mimeFor = (data: DownloadData, explicit?: string): string =>
  explicit ??
  (typeof data === 'string'
    ? 'text/plain;charset=utf-8'
    : 'application/octet-stream');

const clickAnchor = (href: string, name?: string): void => {
  const anchor = document.createElement('a');
  anchor.href = href;
  if (name) anchor.download = name;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
};

/** Downloads through a temporary anchor; data goes through an object URL. */
export const download: DownloadPort = {
  async save(data, options) {
    const blob =
      data instanceof Blob
        ? data
        : new Blob([data as BlobPart], {
            type: mimeFor(data, options.mimeType),
          });
    const href = URL.createObjectURL(blob);
    try {
      clickAnchor(href, options.name);
    } finally {
      // Give the browser a tick to start the download before revoking.
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    }
  },
  saveUrl: clickAnchor,
};

export const fullscreen: FullscreenPort = {
  async enter(element) {
    const target =
      (element as HTMLElement | undefined) ?? document.documentElement;
    if (!target.requestFullscreen) throw new CapabilityError('fullscreen');
    await target.requestFullscreen();
  },
  async exit() {
    if (!document.exitFullscreen) throw new CapabilityError('fullscreen');
    await document.exitFullscreen();
  },
  async pictureInPicture(element) {
    const video = element as
      | (HTMLVideoElement & { requestPictureInPicture?(): Promise<unknown> })
      | undefined;
    if (!video?.requestPictureInPicture)
      throw new CapabilityError('pictureInPicture');
    await video.requestPictureInPicture();
  },
};

// Absent on insecure origins.
const mediaDevices = (): MediaDevices | undefined => navigator.mediaDevices;

/** One frame of a camera stream; the stream is stopped afterwards. */
export const camera: CameraPort = {
  async capture(options) {
    const devices = mediaDevices();
    if (!devices?.getUserMedia) throw new CapabilityError('camera');
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
  },
};

/**
 * Web only: the live microphone stream, for an app that processes audio
 * itself (a level meter, WebRTC). The app stops its tracks. Host-neutral
 * code records with the SDK's `startRecording` instead.
 */
export function openMicrophoneStream(): Promise<MediaStream> {
  const devices = mediaDevices();
  if (!devices?.getUserMedia)
    return Promise.reject(new CapabilityError('microphone'));
  return devices.getUserMedia({ audio: true });
}

/** Records the microphone with `MediaRecorder` into a `Blob`. */
export const microphone: MicrophonePort = {
  async start(options) {
    if (typeof MediaRecorder !== 'function')
      throw new CapabilityError('microphone');
    const stream = await openMicrophoneStream();
    const preferred = options.mimeType;
    const recorder =
      preferred && MediaRecorder.isTypeSupported?.(preferred)
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const started = Date.now();
    recorder.start();
    let recording: Promise<Recording> | undefined;
    return {
      stop: () =>
        (recording ??= new Promise((resolve, reject) => {
          recorder.onerror = () => reject(new Error('Recording failed'));
          recorder.onstop = () => {
            for (const track of stream.getTracks()) track.stop();
            const mimeType = recorder.mimeType || preferred || 'audio/webm';
            resolve({
              mimeType,
              blob: new Blob(chunks, { type: mimeType }),
              durationMs: Date.now() - started,
            });
          };
          recorder.stop();
        })),
    };
  },
};

/** A hidden `<input type="file">`, removed once the user chose or cancelled. */
export const filePicker: FilePickerPort = {
  pick(options) {
    return new Promise((resolve, reject) => {
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
        reject(error as Error);
      }
    });
  },
};

/** One `HTMLAudioElement`, created by the first `play`. */
// The element is created on first play. Browsers allow play() only while
// handling a user gesture, so the port must already be loaded then.
function createAudio(): AudioPort {
  let element: HTMLAudioElement | undefined;
  let volume = 1;
  // Whether the next `pause` event is one this port asked for. Any other is
  // the browser's or the system's doing: reported as `interrupted`.
  let asked = false;
  const listeners = new Set<(state: AudioPlaybackState) => void>();
  const emit = (state: AudioPlaybackState) => {
    for (const listener of listeners) listener(state);
  };
  const ensure = () => {
    if (!element) {
      if (typeof Audio === 'undefined') throw new CapabilityError('audio');
      const created = (element = new Audio());
      created.preload = 'metadata';
      created.volume = volume;
      // Media events only: nothing here runs while the element is silent.
      created.addEventListener('playing', () => emit('playing'));
      created.addEventListener('ended', () => emit('ended'));
      created.addEventListener('pause', () => {
        const mine = asked;
        asked = false;
        // The end of a track also pauses it; `ended` reports that.
        if (!created.ended) emit(mine ? 'paused' : 'interrupted');
      });
    }
    return element;
  };
  return {
    async play(track, options = {}) {
      const player = ensure();
      asked = false;
      player.src = track.url;
      if (options.volume !== undefined) {
        volume = Math.min(1, Math.max(0, options.volume));
        player.volume = volume;
      }
      if (options.position) player.currentTime = options.position;
      await player.play();
    },
    async pause() {
      if (!element || element.paused) return;
      asked = true;
      element.pause();
    },
    async resume() {
      await element?.play();
    },
    async stop() {
      if (!element) return;
      asked = !element.paused;
      element.pause();
      element.removeAttribute('src');
      element.load();
    },
    async seek(position) {
      if (element) element.currentTime = Math.max(0, position);
    },
    setVolume(next) {
      volume = Math.min(1, Math.max(0, next));
      if (element) element.volume = volume;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const audio: AudioPort = createAudio();
