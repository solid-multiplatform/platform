// `TextEncoder` and `TextDecoder` (Encoding Standard), UTF-8 only.
//
// `encodeUtf8` and `decodeUtf8` are the loops over whole inputs; the classes
// add what the standard has around them (labels, the byte order mark,
// streaming), so a native pair can replace the two functions alone.

/** Code units of the text the last `write` consumed. */
let read = 0;

/**
 * Writes `text` from code unit `from` into `out` at `at` as UTF-8 and stops
 * before the first character that does not fit. Returns where it stopped in
 * `out`, and in `text` through `read`. A lone surrogate is written as U+FFFD.
 */
function write(
  text: string,
  from: number,
  out: Uint8Array,
  at: number,
): number {
  const length = text.length;
  const capacity = out.length;
  let i = from;
  for (; i < length; i++) {
    let c = text.charCodeAt(i);
    if (c < 0x80) {
      if (at >= capacity) break;
      out[at++] = c;
      continue;
    }
    if (c < 0x800) {
      if (at + 2 > capacity) break;
      out[at++] = 0xc0 | (c >> 6);
      out[at++] = 0x80 | (c & 0x3f);
      continue;
    }
    if (c >= 0xd800 && c <= 0xdfff) {
      const low = c < 0xdc00 && i + 1 < length ? text.charCodeAt(i + 1) : 0;
      if (low >= 0xdc00 && low <= 0xdfff) {
        if (at + 4 > capacity) break;
        c = 0x10000 + ((c - 0xd800) << 10) + (low - 0xdc00);
        i++;
        out[at++] = 0xf0 | (c >> 18);
        out[at++] = 0x80 | ((c >> 12) & 0x3f);
        out[at++] = 0x80 | ((c >> 6) & 0x3f);
        out[at++] = 0x80 | (c & 0x3f);
        continue;
      }
      c = 0xfffd;
    }
    if (at + 3 > capacity) break;
    out[at++] = 0xe0 | (c >> 12);
    out[at++] = 0x80 | ((c >> 6) & 0x3f);
    out[at++] = 0x80 | (c & 0x3f);
  }
  read = i;
  return at;
}

/** The UTF-8 bytes of `text`, in a buffer of exactly their size. */
export function encodeUtf8(text: string): Uint8Array {
  const length = text.length;
  const ascii = new Uint8Array(length);
  let i = 0;
  for (; i < length; i++) {
    const c = text.charCodeAt(i);
    if (c > 0x7f) break;
    ascii[i] = c;
  }
  if (i === length) return ascii;
  // Not all ASCII: the size of the rest is counted first.
  let size = i;
  for (let j = i; j < length; j++) {
    const c = text.charCodeAt(j);
    if (c < 0x80) size += 1;
    else if (c < 0x800) size += 2;
    else if (
      c >= 0xd800 &&
      c < 0xdc00 &&
      j + 1 < length &&
      (text.charCodeAt(j + 1) & 0xfc00) === 0xdc00
    ) {
      size += 4;
      j++;
    } else size += 3;
  }
  const out = new Uint8Array(size);
  out.set(ascii.subarray(0, i));
  write(text, i, out, i);
  return out;
}

// Arguments of one `String.fromCharCode` call: well under what the engine's
// stack takes.
const RUN = 8192;

/**
 * The text of UTF-8 `bytes`, all of them: an incomplete sequence at the end
 * is an error like any other. An error throws a `TypeError` when `fatal`,
 * and otherwise becomes one U+FFFD per maximal invalid part, as the standard
 * has it. A byte order mark is decoded like any character.
 */
export function decodeUtf8(bytes: Uint8Array, fatal: boolean): string {
  const end = bytes.length;
  let out = '';
  let i = 0;
  while (i < end) {
    const lead = bytes[i]!;
    if (lead < 0x80) {
      // A run of ASCII becomes a string in one call.
      let j = i + 1;
      while (j < end && bytes[j]! < 0x80) j++;
      if (j - i < 4) {
        for (; i < j; i++) out += String.fromCharCode(bytes[i]!);
      } else {
        for (; i < j; i += RUN)
          out += String.fromCharCode.apply(
            null,
            bytes.subarray(i, i + RUN < j ? i + RUN : j) as unknown as number[],
          );
        i = j;
      }
      continue;
    }
    i++;
    // The lead byte says how many bytes follow and what the first of them
    // may be: the bounds exclude overlong forms, surrogates and anything
    // above U+10FFFF.
    let needed = 0;
    let point = -1;
    let lower = 0x80;
    let upper = 0xbf;
    if (lead >= 0xc2 && lead <= 0xdf) {
      needed = 1;
      point = lead & 0x1f;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      needed = 2;
      point = lead & 0x0f;
      if (lead === 0xe0) lower = 0xa0;
      else if (lead === 0xed) upper = 0x9f;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      needed = 3;
      point = lead & 0x07;
      if (lead === 0xf0) lower = 0x90;
      else if (lead === 0xf4) upper = 0x8f;
    }
    for (; needed > 0; needed--) {
      const next = i < end ? bytes[i]! : 0;
      if (next < lower || next > upper) {
        // The byte that does not continue the sequence is decoded again,
        // as the start of the next one.
        point = -1;
        break;
      }
      lower = 0x80;
      upper = 0xbf;
      point = (point << 6) | (next & 0x3f);
      i++;
    }
    if (point < 0) {
      if (fatal)
        throw new TypeError('TextDecoder: the input is not valid UTF-8');
      out += '�';
    } else if (point > 0xffff) {
      point -= 0x10000;
      out += String.fromCharCode(
        0xd800 | (point >> 10),
        0xdc00 | (point & 0x3ff),
      );
    } else {
      out += String.fromCharCode(point);
    }
  }
  return out;
}

/**
 * How many bytes at the end of `bytes` start a sequence that more input
 * could complete: what a streaming decoder holds back.
 */
function incompleteTail(bytes: Uint8Array): number {
  const end = bytes.length;
  for (let back = 1; back <= 3 && back <= end; back++) {
    const lead = bytes[end - back]!;
    if ((lead & 0xc0) === 0x80) continue;
    const needed =
      lead >= 0xc2 && lead <= 0xdf
        ? 2
        : lead >= 0xe0 && lead <= 0xef
          ? 3
          : lead >= 0xf0 && lead <= 0xf4
            ? 4
            : 0;
    if (back >= needed) return 0;
    if (back > 1) {
      // The second byte has narrower bounds after some leads; outside them
      // the sequence is already invalid and nothing is held back.
      const second = bytes[end - back + 1]!;
      const lower = lead === 0xe0 ? 0xa0 : lead === 0xf0 ? 0x90 : 0x80;
      const upper = lead === 0xed ? 0x9f : lead === 0xf4 ? 0x8f : 0xbf;
      if (second < lower || second > upper) return 0;
    }
    return back;
  }
  return 0;
}

export type BufferSource = ArrayBuffer | ArrayBufferView;

/** The bytes of a buffer or a view, in place. */
export function viewBytes(source: BufferSource): Uint8Array {
  if (ArrayBuffer.isView(source))
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  throw new TypeError('The input is not an ArrayBuffer or a view of one');
}

export class TextEncoder {
  get encoding(): string {
    return 'utf-8';
  }

  encode(input = ''): Uint8Array {
    return encodeUtf8(String(input));
  }

  encodeInto(
    source: string,
    destination: Uint8Array,
  ): { read: number; written: number } {
    const written = write(String(source), 0, destination, 0);
    return { read, written };
  }

  get [Symbol.toStringTag](): string {
    return 'TextEncoder';
  }
}

// The labels of UTF-8 in the standard.
const UTF8_LABELS = [
  'utf-8',
  'utf8',
  'unicode-1-1-utf-8',
  'unicode11utf8',
  'unicode20utf8',
  'x-unicode20utf8',
];

export interface TextDecoderOptions {
  fatal?: boolean;
  ignoreBOM?: boolean;
}

export class TextDecoder {
  readonly #fatal: boolean;
  readonly #ignoreBOM: boolean;
  // Streaming state: the bytes held back, and whether the start of the
  // stream, where a byte order mark is not text, has passed.
  #pending: Uint8Array | null = null;
  #started = false;

  constructor(label = 'utf-8', options?: TextDecoderOptions) {
    const name = String(label)
      .replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '')
      .toLowerCase();
    if (!UTF8_LABELS.includes(name))
      throw new RangeError(
        `TextDecoder: the encoding "${label}" is not implemented by the desktop host (UTF-8 only)`,
      );
    this.#fatal = !!options?.fatal;
    this.#ignoreBOM = !!options?.ignoreBOM;
  }

  get encoding(): string {
    return 'utf-8';
  }
  get fatal(): boolean {
    return this.#fatal;
  }
  get ignoreBOM(): boolean {
    return this.#ignoreBOM;
  }
  get [Symbol.toStringTag](): string {
    return 'TextDecoder';
  }

  decode(input?: BufferSource, options?: { stream?: boolean }): string {
    let bytes = input === undefined ? new Uint8Array(0) : viewBytes(input);
    const pending = this.#pending;
    if (pending !== null) {
      // Only when a sequence was split between two chunks.
      const joined = new Uint8Array(pending.length + bytes.length);
      joined.set(pending);
      joined.set(bytes, pending.length);
      bytes = joined;
      this.#pending = null;
    }
    const stream = !!options?.stream;
    if (stream) {
      const held = incompleteTail(bytes);
      if (held > 0) {
        this.#pending = bytes.slice(bytes.length - held);
        bytes = bytes.subarray(0, bytes.length - held);
      }
    }
    let text: string;
    try {
      text = decodeUtf8(bytes, this.#fatal);
    } catch (error) {
      this.#pending = null;
      this.#started = false;
      throw error;
    }
    if (!this.#started && text.length > 0) {
      this.#started = true;
      if (!this.#ignoreBOM && text.charCodeAt(0) === 0xfeff)
        text = text.slice(1);
    }
    if (!stream) this.#started = false;
    return text;
  }
}
