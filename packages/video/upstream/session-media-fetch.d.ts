/** Typed fetch failures must not hide permanent refusals from the demuxer's retry policy. */
export declare function sessionMediaRetryDelay(direct: boolean): (attempts: number, error: unknown) => number | null;
interface TransferSample {
    readonly bytes: number;
    readonly seconds: number;
}
/** The application supplies an authorized delivery, not an arbitrary proxy URL. */
export declare function checkedMediaDelivery(value: string): URL;
/** One delivery-origin/directory fence for files, manifests, segments and keys. */
export declare function sessionMediaRequest(url: string, input: RequestInfo | URL, init?: RequestInit): Request;
/**
 * Offset of the first MPEG-TS packet in `bytes`, or -1. IPTV CDNs disguise
 * segments as images or fonts by prepending a real PNG/JPEG/GIF header (or
 * other junk) to the transport stream, so a segment is classified by its
 * bytes, never by its name or Content-Type. A packet run must repeat at the
 * 188-byte stride; a short buffer that ends the run still needs three packets.
 */
export declare function transportStreamOffset(bytes: Uint8Array): number;
/** Nested resources stay inside the selected delivery even on another gateway. */
export declare function sessionMediaFetch(url: string, observe?: (sample: TransferSample) => void): typeof fetch;
export {};
