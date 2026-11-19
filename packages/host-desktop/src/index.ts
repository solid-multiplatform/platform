// The desktop host: runs a Solid Multiplatform app in the native runtime
// (packages/host-desktop/native) with the WebGL renderer.
//
//     import { startApp } from '@solid-multiplatform/platform/host';
//     import { desktopHost } from '@solid-multiplatform/host-desktop';
//
//     startApp(desktopHost({ id: 'com.example.app' }), App, { fonts });
//
// Importing this module installs the web-standard globals the engine lacks
// (./standard.ts); it does nothing else until an app starts.
/// <reference path="./native.d.ts" />
import './standard.js';
import { launchDesktop } from './host.js';

export {
  desktopHost,
  launchDesktop,
  type DesktopHostOptions,
  type DesktopSurface,
} from './host.js';
export { desktopSemantics, type DesktopSemanticsSink } from './semantics.js';
export { DesktopPlatform } from './platform.js';
export type { FieldStyle } from './field.jsx';
export type { DesktopEditor, DesktopEditorHost } from './editor.js';
export type { DesktopFileSystemPort } from './services/files.js';

/**
 * Start an app that creates its renderer itself: `mount` renders the scene
 * and may return a function that disposes of it. The window, input and
 * services are the host's, as with `startApp(desktopHost())`, which is the
 * way to start an app; this is for code that predates it.
 *
 * Returns the function that disposes of the app.
 */
export function startDesktop(mount: () => (() => void) | void): () => void {
  return launchDesktop({}, () => mount() ?? (() => {}));
}
