/**
 * Throws when `condition` is falsy in development builds; a no-op in
 * production. Narrows the type of `condition` for TypeScript either way.
 */
export declare function assertTruthy(condition: unknown, message?: string): asserts condition;
/**
 * An image URL made absolute for the image worker, which resolves against
 * its own blob: URL, not the document (ported from 1.10). An absolute URL
 * returns unchanged without the URL constructor's cost; under a `file:`
 * document a relative path joins the document's folder.
 *
 * With a document, an `<a>` element resolves the URL: legacy builds polyfill
 * `URL` on old engines (Chrome 38 lacks `searchParams`, so core-js replaces
 * it with a JavaScript parser), which took a quarter of the main thread on
 * a webOS 3 TV while posters loaded.
 */
export declare function convertUrlToAbsolute(url: string): string;
/** A `data:` URI (decoded on the main thread: no fetch, no worker). */
export declare function isBase64Image(src: string): boolean;
/** A base64 `data:` URI as a Blob of its MIME type (ported from 1.10). */
export declare function dataURIToBlob(dataURI: string): Blob;
