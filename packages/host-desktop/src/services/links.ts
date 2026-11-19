// The `links` service: the URL the app was opened with. A packaged app's
// launcher entry declares its scheme (`MimeType=x-scheme-handler/<scheme>`,
// see cli/package.mjs), and the system then starts the app with the URL as
// an argument.
//
// Every launch is a process of its own: a link opened while the app runs
// starts a second instance, which gets it as its launch link. Nothing is
// forwarded to the first, so `subscribe` never calls its listener here.
import type { LinksPort } from '@solid-multiplatform/platform/services';

/** `scheme:rest`, with a scheme of two letters or more: not `C:\path`. */
const URL_LIKE = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

export function links(): LinksPort {
  const first = __solid.args.find((argument) => URL_LIKE.test(argument));
  return {
    initial: () => first ?? null,
    subscribe: () => () => {},
  };
}
