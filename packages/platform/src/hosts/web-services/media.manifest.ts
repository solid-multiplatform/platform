// Browser providers for: audio, media session, fullscreen and picture-in-picture, thumbnails, DRM and codec capabilities, camera, microphone, downloads, files and file pickers.
// Each entry loads its implementation from ./media.ts on first use.
import type { ProviderMap } from '../../sdk/registry.js';

export const mediaServices: ProviderMap = {};
