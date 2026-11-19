// Installs the web-standard globals Hermes lacks: `URL`, `URLSearchParams`,
// `TextEncoder`, `TextDecoder`, `Event`, `EventTarget`, `DOMException`,
// `AbortController`, `AbortSignal`, `Headers`, `Request`, `Response`,
// `fetch`, `structuredClone` (./web), `Blob` (./globals.ts) and
// `KeyboardEvent` (./keys.ts) and `Intl` (./web/intl.ts, over the native
// ICU4X formatters). Each only where the engine has none. Defining them is
// all this does; no formatter is built until an app asks for one.
//
// `KeyboardEvent` is here because the platform's shortcuts and media keys
// ask `event instanceof KeyboardEvent` (packages/platform/src/sdk/
// shortcuts.ts:138 and :198, sdk/media.ts:261): the class is what this
// host's key events are instances of, not a stand-in for a browser's.
import './globals.js';
import { DesktopKeyboardEvent } from './keys.js';
import { transport } from './services/request.js';
import { installWebGlobals } from './web/index.js';

installWebGlobals(transport);
const scope = globalThis as { KeyboardEvent?: unknown };
if (scope.KeyboardEvent === undefined) {
  Object.defineProperty(scope, 'KeyboardEvent', {
    value: DesktopKeyboardEvent,
    writable: true,
    configurable: true,
  });
}
