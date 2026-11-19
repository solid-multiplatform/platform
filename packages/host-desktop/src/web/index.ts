// The web-standard globals Hermes does not have, written here: events,
// abort signals, URLs, text encoding, fetch's classes and structured clone.
// Each module says what of its standard it leaves out; those parts throw.
import { AbortController, AbortSignal } from './abort.js';
import { structuredClone } from './clone.js';
import { DOMException } from './dom-exception.js';
import { TextDecoder, TextEncoder } from './encoding.js';
import { Event, EventTarget } from './events.js';
import {
  createFetch,
  Headers,
  Request,
  Response,
  type HttpTransport,
} from './fetch.js';
import { installIntl } from './intl.js';
import { URL, URLSearchParams } from './url.js';

export {
  AbortController,
  AbortSignal,
  createFetch,
  DOMException,
  Event,
  EventTarget,
  Headers,
  Request,
  Response,
  structuredClone,
  TextDecoder,
  TextEncoder,
  URL,
  URLSearchParams,
};
export { installIntl } from './intl.js';
export { decodeUtf8, encodeUtf8 } from './encoding.js';
export type { EventInit, EventListener } from './events.js';
export type {
  BodyInit,
  HeadersInit,
  HttpRequest,
  HttpResponse,
  HttpTransport,
  RequestInit,
  ResponseInit,
} from './fetch.js';

/**
 * Defines each of the globals that the engine does not already have, as the
 * engine would: writable, configurable and not enumerable. `fetch` needs a
 * transport, and without one it stays undefined. Nothing else happens here:
 * no timer, no listener.
 */
export function installWebGlobals(transport?: HttpTransport): void {
  const globals: Record<string, unknown> = {
    AbortController,
    AbortSignal,
    DOMException,
    Event,
    EventTarget,
    Headers,
    Request,
    Response,
    structuredClone,
    TextDecoder,
    TextEncoder,
    URL,
    URLSearchParams,
  };
  if (transport !== undefined) globals.fetch = createFetch(transport);
  // `Intl` is a whole namespace, so it is installed by its own module; this
  // defines the classes only, and builds no formatter.
  installIntl();
  const scope = globalThis as Record<string, unknown>;
  for (const name of Object.keys(globals))
    if (typeof scope[name] === 'undefined')
      Object.defineProperty(scope, name, {
        value: globals[name],
        writable: true,
        configurable: true,
        enumerable: false,
      });
}
