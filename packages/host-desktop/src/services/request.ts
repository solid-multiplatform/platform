// Network requests: the runtime's HTTP client as the transport of `fetch`.
// One `fetch` serves the `request` service, the global and the renderer's
// asset loader.
import {
  createFetch,
  type HttpResponse,
  type HttpTransport,
} from '../web/fetch.js';

/** A flat list of names and values as pairs. */
function pairs(flat: string[]): [string, string][] {
  const result: [string, string][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    result.push([flat[i]!, flat[i + 1]!]);
  }
  return result;
}

/** Requests on the runtime's worker threads (native/src/http.rs). */
export const transport: HttpTransport = {
  send(request, done) {
    const headers: string[] = [];
    for (const [name, value] of request.headers) headers.push(name, value);
    const id = __solid.http.send(
      request.method,
      request.url,
      headers,
      request.body,
      request.redirect === 'follow',
      (error, status, statusText, url, redirected, responseHeaders, body) => {
        if (error !== null) {
          done(error);
          return;
        }
        const response: HttpResponse = {
          status: status!,
          statusText: statusText!,
          url: url!,
          redirected: redirected!,
          headers: pairs(responseHeaders!),
          body: body!,
        };
        done(null, response);
      },
    );
    return () => __solid.http.abort(id);
  },
};

/** `fetch` over the runtime's HTTP client. */
export const desktopFetch: typeof fetch = createFetch(transport);

/**
 * The body of a successful GET, for the asset loader: a status outside
 * 200-299 is a failure there, as a missing file is.
 */
export function httpBytes(url: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    transport.send(
      { method: 'GET', url, headers: [], redirect: 'follow' },
      (error, response) => {
        if (error !== null)
          reject(new Error(`Cannot load ${url}: ${error.message}`));
        else if (response!.status < 200 || response!.status > 299)
          reject(new Error(`Cannot load ${url}: HTTP ${response!.status}`));
        else resolve(response!.body);
      },
    );
  });
}
