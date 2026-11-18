// Browser providers for: audio, media session, fullscreen and picture-in-picture, thumbnails, DRM and codec capabilities, camera, microphone, downloads, file pickers.
//
// Lazy entries load ./media.ts on first use. Eager entries are the plain
// objects of ./media.sync.ts, for two reasons:
//
// - Browsers allow audio playback, fullscreen, picture-in-picture, the file
//   picker, downloads and the camera and microphone prompts only while
//   handling a user gesture.
//   An `import()` between the app's call and the browser's would lose the
//   gesture on the first use, so these must already be loaded.
// - `configureMediaSession` and `downloadUrl` are synchronous.
//
// Not here: a file system (a page has no app-owned directories).
import type { ProviderMap } from '../../sdk/registry.js';
import {
  audio,
  camera,
  download,
  filePicker,
  fullscreen,
  mediaSession,
  microphone,
} from './media.sync.js';

const load = () => import('./media.js');

export const mediaServices: ProviderMap = {
  // Eager: needs the user's gesture.
  audio,
  fullscreen,
  filePicker,
  download,
  camera,
  microphone,
  // Eager: read by a synchronous SDK function.
  mediaSession,
  // Lazy.
  thumbnails: () => load().then((m) => m.thumbnails),
  mediaCapabilities: () => load().then((m) => m.mediaCapabilities),
};
