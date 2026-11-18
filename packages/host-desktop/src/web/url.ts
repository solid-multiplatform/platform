// `URL` and `URLSearchParams` (WHATWG URL Standard): the standard's parser,
// state by state, over one string.
//
// Not implemented: hosts outside ASCII (IDNA and Punycode need the Unicode
// tables), which throw a `TypeError` that says so, and with them the
// validation of `xn--` labels, which are taken as written; and
// `URL.createObjectURL`.
import { decodeUtf8, encodeUtf8 } from './encoding.js';

/** A URL record. A host is kept serialised; a string path is an opaque one. */
interface UrlRecord {
  scheme: string;
  username: string;
  password: string;
  host: string | null;
  port: number | null;
  path: string[] | string;
  query: string | null;
  fragment: string | null;
}

// --- Percent-encoding -----------------------------------------------------

// The percent-encode sets, one bit each. Every set also has the C0 controls
// and everything above U+007E; the C0 control set is those alone (0).
const C0 = 0;
const FRAGMENT = 1;
const QUERY = 2;
const SPECIAL_QUERY = 4;
const PATH = 8;
const USERINFO = 16;
const FORM = 32;

const SETS = new Uint8Array(128);
function mark(characters: string, sets: number): void {
  for (let i = 0; i < characters.length; i++)
    SETS[characters.charCodeAt(i)]! |= sets;
}
mark(' "<>`', FRAGMENT);
mark(' "#<>', QUERY | SPECIAL_QUERY | PATH | USERINFO | FORM);
mark("'", SPECIAL_QUERY | FORM);
mark('?^`{}', PATH | USERINFO | FORM);
mark('/:;=@[\\]|', USERINFO | FORM);
mark("$%&+,!'()~", FORM);

const HEX = '0123456789ABCDEF';
const escapeByte = (byte: number): string =>
  '%' + HEX[byte >> 4]! + HEX[byte & 15]!;

/** The escapes of the UTF-8 bytes of one code point. */
function escapePoint(point: number): string {
  if (point < 0x80) return escapeByte(point);
  if (point < 0x800)
    return escapeByte(0xc0 | (point >> 6)) + escapeByte(0x80 | (point & 0x3f));
  // `codePointAt` gives a surrogate only when it is a lone one.
  if (point >= 0xd800 && point <= 0xdfff) point = 0xfffd;
  const tail =
    escapeByte(0x80 | ((point >> 6) & 0x3f)) +
    escapeByte(0x80 | (point & 0x3f));
  return point < 0x10000
    ? escapeByte(0xe0 | (point >> 12)) + tail
    : escapeByte(0xf0 | (point >> 18)) +
        escapeByte(0x80 | ((point >> 12) & 0x3f)) +
        tail;
}

/** UTF-8 percent-encodes `text` with a set; `plus` writes a space as `+`. */
function encode(text: string, set: number, plus = false): string {
  let out = '';
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const point = text.codePointAt(i)!;
    if (point < 0x7f && point > 0x1f && (SETS[point]! & set) === 0) continue;
    out +=
      text.slice(from, i) + (plus && point === 0x20 ? '+' : escapePoint(point));
    if (point > 0xffff) i++;
    from = i + 1;
  }
  return from === 0 ? text : out + text.slice(from);
}

const hexValue = (c: number): number =>
  c >= 0x30 && c <= 0x39
    ? c - 0x30
    : (c | 0x20) >= 0x61 && (c | 0x20) <= 0x66
      ? (c | 0x20) - 0x57
      : -1;

/** The bytes `text` stands for once its `%XX` escapes are bytes. */
function percentDecode(text: string): Uint8Array {
  const bytes = encodeUtf8(text);
  let to = 0;
  for (let i = 0; i < bytes.length; i++) {
    let byte = bytes[i]!;
    if (byte === 0x25 && i + 2 < bytes.length) {
      const high = hexValue(bytes[i + 1]!);
      const low = hexValue(bytes[i + 2]!);
      if (high >= 0 && low >= 0) {
        byte = (high << 4) | low;
        i += 2;
      }
    }
    bytes[to++] = byte;
  }
  return bytes.subarray(0, to);
}

// --- Hosts ----------------------------------------------------------------

const FORBIDDEN_HOST = /[\0\t\n\r #/:<>?@[\\\]^|]/;
const FORBIDDEN_DOMAIN = /[\0-\x20#%/:<>?@[\\\]^|\x7f]/;
const NOT_ASCII = /[^\0-\x7f]/;
const DECIMAL = /^[0-9]+$/;
const OCTAL = /^[0-7]+$/;
const HEXADECIMAL = /^[0-9a-f]+$/i;

const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
const isAlpha = (c: number): boolean =>
  (c | 0x20) >= 0x61 && (c | 0x20) <= 0x7a;

/** A part of an IPv4 address in any of its notations; -1 when it is none. */
function ipv4Number(part: string): number {
  if (part === '') return -1;
  let digits = part;
  let valid = DECIMAL;
  let radix = 10;
  if (part.length > 1 && part.charCodeAt(0) === 0x30) {
    if ((part.charCodeAt(1) | 0x20) === 0x78) {
      digits = part.slice(2);
      valid = HEXADECIMAL;
      radix = 16;
    } else {
      digits = part.slice(1);
      valid = OCTAL;
      radix = 8;
    }
  }
  if (digits === '') return 0;
  return valid.test(digits) ? parseInt(digits, radix) : -1;
}

/** Whether the last label of a domain is a number: then it is an IPv4 address. */
function endsInNumber(domain: string): boolean {
  let end = domain.length;
  if (domain.charCodeAt(end - 1) === 0x2e) end--;
  if (end <= 0) return false;
  const last = domain.slice(domain.lastIndexOf('.', end - 1) + 1, end);
  return last !== '' && (DECIMAL.test(last) || ipv4Number(last) >= 0);
}

function parseIPv4(domain: string): string | null {
  const parts = domain.split('.');
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  const count = parts.length;
  if (count > 4) return null;
  let address = 0;
  for (let i = 0; i < count; i++) {
    const part = ipv4Number(parts[i]!);
    if (part < 0) return null;
    if (i < count - 1) {
      if (part > 255) return null;
      address += part * 256 ** (3 - i);
    } else {
      // The last part fills what the others left.
      if (part >= 256 ** (5 - count)) return null;
      address += part;
    }
  }
  return (
    (address >>> 24) +
    '.' +
    ((address >>> 16) & 255) +
    '.' +
    ((address >>> 8) & 255) +
    '.' +
    (address & 255)
  );
}

/** Parses what is between the brackets and serialises it, brackets included. */
function parseIPv6(input: string): string | null {
  const address = [0, 0, 0, 0, 0, 0, 0, 0];
  const length = input.length;
  let piece = 0;
  let compress = -1;
  let p = 0;
  if (input.charCodeAt(0) === 0x3a) {
    if (input.charCodeAt(1) !== 0x3a) return null;
    p = 2;
    compress = ++piece;
  }
  while (p < length) {
    if (piece === 8) return null;
    if (input.charCodeAt(p) === 0x3a) {
      if (compress >= 0) return null;
      p++;
      compress = ++piece;
      continue;
    }
    let value = 0;
    let digits = 0;
    for (; digits < 4; digits++, p++) {
      const digit = hexValue(input.charCodeAt(p));
      if (digit < 0) break;
      value = value * 16 + digit;
    }
    const c = input.charCodeAt(p);
    if (c === 0x2e) {
      // The last 32 bits written as an IPv4 address.
      if (digits === 0 || piece > 6) return null;
      p -= digits;
      let seen = 0;
      while (p < length) {
        if (seen > 0) {
          if (input.charCodeAt(p) !== 0x2e || seen === 4) return null;
          p++;
        }
        let part = -1;
        for (let d; isDigit((d = input.charCodeAt(p))); p++) {
          if (part === 0) return null;
          part = part < 0 ? d - 0x30 : part * 10 + d - 0x30;
          if (part > 255) return null;
        }
        if (part < 0) return null;
        address[piece] = address[piece]! * 256 + part;
        if (++seen === 2 || seen === 4) piece++;
      }
      if (seen !== 4) return null;
      break;
    }
    if (c === 0x3a) {
      if (++p >= length) return null;
    } else if (p < length) return null;
    address[piece++] = value;
  }
  if (compress >= 0) {
    for (
      let swaps = piece - compress, i = 7;
      i > 0 && swaps > 0;
      i--, swaps--
    ) {
      const other = compress + swaps - 1;
      const kept = address[i]!;
      address[i] = address[other]!;
      address[other] = kept;
    }
  } else if (piece !== 8) return null;

  // The first longest run of two or more zero pieces is written as "::".
  let run = -1;
  let runLength = 1;
  for (let i = 0; i < 8; i++) {
    if (address[i] !== 0) continue;
    let j = i + 1;
    while (j < 8 && address[j] === 0) j++;
    if (j - i > runLength) {
      run = i;
      runLength = j - i;
    }
    i = j;
  }
  let out = '[';
  for (let i = 0; i < 8; i++) {
    if (i === run) {
      out += i === 0 ? '::' : ':';
      i += runLength - 1;
      continue;
    }
    out += address[i]!.toString(16);
    if (i < 7) out += ':';
  }
  return out + ']';
}

/** The host parser. Null is failure. */
function parseHost(input: string, opaque: boolean): string | null {
  if (input.charCodeAt(0) === 0x5b)
    return input.charCodeAt(input.length - 1) === 0x5d
      ? parseIPv6(input.slice(1, -1))
      : null;
  if (opaque) return FORBIDDEN_HOST.test(input) ? null : encode(input, C0);
  const domain = input.includes('%')
    ? decodeUtf8(percentDecode(input), false)
    : input;
  if (NOT_ASCII.test(domain))
    throw new TypeError(
      `URL: the host "${input}" is not ASCII, and internationalized domain names (IDNA) are not implemented by the desktop host`,
    );
  if (domain === '' || FORBIDDEN_DOMAIN.test(domain)) return null;
  const ascii = domain.toLowerCase();
  return endsInNumber(ascii) ? parseIPv4(ascii) : ascii;
}

// --- The parser -------------------------------------------------------------

/** The default port of a special scheme; 0 for `file`, -1 when not special. */
function defaultPort(scheme: string): number {
  switch (scheme) {
    case 'http':
    case 'ws':
      return 80;
    case 'https':
    case 'wss':
      return 443;
    case 'ftp':
      return 21;
    case 'file':
      return 0;
  }
  return -1;
}

const isDriveLetter = (text: string): boolean =>
  text.length === 2 &&
  isAlpha(text.charCodeAt(0)) &&
  (text.charCodeAt(1) === 0x3a || text.charCodeAt(1) === 0x7c);

const isNormalizedDriveLetter = (text: string): boolean =>
  isDriveLetter(text) && text.charCodeAt(1) === 0x3a;

function startsWithDriveLetter(input: string, at: number): boolean {
  if (!isDriveLetter(input.slice(at, at + 2))) return false;
  if (input.length === at + 2) return true;
  const next = input.charCodeAt(at + 2);
  return next === 0x2f || next === 0x5c || next === 0x3f || next === 0x23;
}

/** Drops the last path segment, except a `file:` URL's drive letter. */
function shorten(url: UrlRecord): void {
  const path = url.path as string[];
  if (
    url.scheme !== 'file' ||
    path.length !== 1 ||
    !isNormalizedDriveLetter(path[0]!)
  )
    path.pop();
}

/** 1 for a single-dot path segment, 2 for a double-dot one, 0 otherwise. */
function dotSegment(segment: string): number {
  if (segment.length > 6) return 0;
  switch (segment.toLowerCase()) {
    case '.':
    case '%2e':
      return 1;
    case '..':
    case '.%2e':
    case '%2e.':
    case '%2e%2e':
      return 2;
  }
  return 0;
}

const enum State {
  None,
  SchemeStart,
  Scheme,
  NoScheme,
  SpecialRelativeOrAuthority,
  PathOrAuthority,
  Relative,
  RelativeSlash,
  SpecialAuthoritySlashes,
  SpecialAuthorityIgnoreSlashes,
  Authority,
  Host,
  Hostname,
  Port,
  File,
  FileSlash,
  FileHost,
  PathStart,
  Path,
  OpaquePath,
  Query,
  Fragment,
}

const EOF = -1;

/**
 * The basic URL parser. Without `target` it parses `raw` against `base` into
 * a new record, and null is failure. With `target` and `override` it is a
 * setter's: it starts in that state, changes `target` in place and stops
 * where the standard says; what it had changed before a failure stays.
 */
function parse(
  raw: string,
  base: UrlRecord | null,
  target: UrlRecord | null = null,
  override: State = State.None,
): UrlRecord | null {
  let input = raw;
  let url: UrlRecord;
  if (target === null) {
    url = {
      scheme: '',
      username: '',
      password: '',
      host: null,
      port: null,
      path: [],
      query: null,
      fragment: null,
    };
    let start = 0;
    let end = input.length;
    while (start < end && input.charCodeAt(start) <= 0x20) start++;
    while (end > start && input.charCodeAt(end - 1) <= 0x20) end--;
    if (end - start !== input.length) input = input.slice(start, end);
  } else {
    url = target;
  }
  input = input.replace(/[\t\n\r]/g, '');

  const length = input.length;
  let state: State = override === State.None ? State.SchemeStart : override;
  let special = defaultPort(url.scheme) >= 0;
  let buffer = '';
  let atSignSeen = false;
  let insideBrackets = false;
  let passwordSeen = false;

  // `continue` looks at the same character again in the new state; `break`
  // out of the switch moves to the next one.
  loop: for (let p = 0; ; ) {
    const c = p < length ? input.charCodeAt(p) : EOF;
    switch (state) {
      case State.SchemeStart:
        if (isAlpha(c)) {
          buffer += input[p]!.toLowerCase();
          state = State.Scheme;
        } else if (override === State.None) {
          state = State.NoScheme;
          continue;
        } else return null;
        break;

      case State.Scheme:
        if (
          isAlpha(c) ||
          isDigit(c) ||
          c === 0x2b ||
          c === 0x2d ||
          c === 0x2e
        ) {
          buffer += input[p]!.toLowerCase();
        } else if (c === 0x3a) {
          if (override !== State.None) {
            if (special !== defaultPort(buffer) >= 0) return null;
            if (
              buffer === 'file' &&
              (url.username !== '' || url.password !== '' || url.port !== null)
            )
              return null;
            if (url.scheme === 'file' && url.host === '') return null;
            url.scheme = buffer;
            if (url.port === defaultPort(buffer)) url.port = null;
            return url;
          }
          url.scheme = buffer;
          special = defaultPort(buffer) >= 0;
          buffer = '';
          if (url.scheme === 'file') state = State.File;
          else if (special && base !== null && base.scheme === url.scheme)
            state = State.SpecialRelativeOrAuthority;
          else if (special) state = State.SpecialAuthoritySlashes;
          else if (input.charCodeAt(p + 1) === 0x2f) {
            state = State.PathOrAuthority;
            p++;
          } else {
            url.path = '';
            state = State.OpaquePath;
          }
        } else if (override === State.None) {
          // Not a scheme after all: from the start, as a relative reference.
          buffer = '';
          state = State.NoScheme;
          p = 0;
          continue;
        } else return null;
        break;

      case State.NoScheme:
        if (base === null) return null;
        if (typeof base.path === 'string') {
          // Only a fragment can be resolved against an opaque path.
          if (c !== 0x23) return null;
          url.scheme = base.scheme;
          url.path = base.path;
          url.query = base.query;
          url.fragment = '';
          state = State.Fragment;
          break;
        }
        state = base.scheme === 'file' ? State.File : State.Relative;
        continue;

      case State.SpecialRelativeOrAuthority:
        if (c === 0x2f && input.charCodeAt(p + 1) === 0x2f) {
          state = State.SpecialAuthorityIgnoreSlashes;
          p++;
          break;
        }
        state = State.Relative;
        continue;

      case State.PathOrAuthority:
        if (c === 0x2f) {
          state = State.Authority;
          break;
        }
        state = State.Path;
        continue;

      case State.Relative:
        url.scheme = base!.scheme;
        special = defaultPort(url.scheme) >= 0;
        if (c === 0x2f || (special && c === 0x5c)) {
          state = State.RelativeSlash;
          break;
        }
        url.username = base!.username;
        url.password = base!.password;
        url.host = base!.host;
        url.port = base!.port;
        url.path = (base!.path as string[]).slice();
        url.query = base!.query;
        if (c === 0x3f) {
          url.query = '';
          state = State.Query;
        } else if (c === 0x23) {
          url.fragment = '';
          state = State.Fragment;
        } else if (c !== EOF) {
          url.query = null;
          shorten(url);
          state = State.Path;
          continue;
        }
        break;

      case State.RelativeSlash:
        if (special && (c === 0x2f || c === 0x5c)) {
          state = State.SpecialAuthorityIgnoreSlashes;
        } else if (c === 0x2f) {
          state = State.Authority;
        } else {
          url.username = base!.username;
          url.password = base!.password;
          url.host = base!.host;
          url.port = base!.port;
          state = State.Path;
          continue;
        }
        break;

      case State.SpecialAuthoritySlashes:
        state = State.SpecialAuthorityIgnoreSlashes;
        if (c === 0x2f && input.charCodeAt(p + 1) === 0x2f) {
          p++;
          break;
        }
        continue;

      case State.SpecialAuthorityIgnoreSlashes:
        if (c === 0x2f || c === 0x5c) break;
        state = State.Authority;
        continue;

      case State.Authority:
        if (c === 0x40) {
          // Everything up to the last "@" is credentials; an earlier "@" is
          // part of them.
          if (atSignSeen) buffer = '%40' + buffer;
          atSignSeen = true;
          const colon = passwordSeen ? -1 : buffer.indexOf(':');
          if (passwordSeen) {
            url.password += encode(buffer, USERINFO);
          } else if (colon < 0) {
            url.username += encode(buffer, USERINFO);
          } else {
            passwordSeen = true;
            url.username += encode(buffer.slice(0, colon), USERINFO);
            url.password += encode(buffer.slice(colon + 1), USERINFO);
          }
          buffer = '';
        } else if (
          c === EOF ||
          c === 0x2f ||
          c === 0x3f ||
          c === 0x23 ||
          (special && c === 0x5c)
        ) {
          if (atSignSeen && buffer === '') return null;
          // What followed the credentials is read again, as the host.
          p -= buffer.length;
          buffer = '';
          state = State.Host;
          continue;
        } else buffer += input[p]!;
        break;

      case State.Host:
      case State.Hostname:
        if (override !== State.None && url.scheme === 'file') {
          state = State.FileHost;
          continue;
        }
        if (c === 0x3a && !insideBrackets) {
          if (buffer === '' || override === State.Hostname) return null;
          const host = parseHost(buffer, !special);
          if (host === null) return null;
          url.host = host;
          buffer = '';
          state = State.Port;
        } else if (
          c === EOF ||
          c === 0x2f ||
          c === 0x3f ||
          c === 0x23 ||
          (special && c === 0x5c)
        ) {
          if (special && buffer === '') return null;
          if (
            override !== State.None &&
            buffer === '' &&
            (url.username !== '' || url.password !== '' || url.port !== null)
          )
            return null;
          const host = parseHost(buffer, !special);
          if (host === null) return null;
          url.host = host;
          if (override !== State.None) return url;
          buffer = '';
          state = State.PathStart;
          continue;
        } else {
          if (c === 0x5b) insideBrackets = true;
          else if (c === 0x5d) insideBrackets = false;
          buffer += input[p]!;
        }
        break;

      case State.Port:
        if (isDigit(c)) {
          buffer += input[p]!;
        } else if (
          c === EOF ||
          c === 0x2f ||
          c === 0x3f ||
          c === 0x23 ||
          (special && c === 0x5c) ||
          override !== State.None
        ) {
          if (buffer !== '') {
            const port = parseInt(buffer, 10);
            if (port > 65535) return null;
            url.port = port === defaultPort(url.scheme) ? null : port;
            buffer = '';
            if (override !== State.None) return url;
          }
          if (override !== State.None) return null;
          state = State.PathStart;
          continue;
        } else return null;
        break;

      case State.File:
        url.scheme = 'file';
        special = true;
        url.host = '';
        if (c === 0x2f || c === 0x5c) {
          state = State.FileSlash;
          break;
        }
        if (base !== null && base.scheme === 'file') {
          url.host = base.host;
          url.path = (base.path as string[]).slice();
          url.query = base.query;
          if (c === 0x3f) {
            url.query = '';
            state = State.Query;
          } else if (c === 0x23) {
            url.fragment = '';
            state = State.Fragment;
          } else if (c !== EOF) {
            url.query = null;
            if (startsWithDriveLetter(input, p)) url.path = [];
            else shorten(url);
            state = State.Path;
            continue;
          }
          break;
        }
        state = State.Path;
        continue;

      case State.FileSlash:
        if (c === 0x2f || c === 0x5c) {
          state = State.FileHost;
          break;
        }
        if (base !== null && base.scheme === 'file') {
          url.host = base.host;
          // A path without a drive letter stays on the base's drive.
          const drive = (base.path as string[])[0];
          if (
            drive !== undefined &&
            isNormalizedDriveLetter(drive) &&
            !startsWithDriveLetter(input, p)
          )
            (url.path as string[]).push(drive);
        }
        state = State.Path;
        continue;

      case State.FileHost:
        if (c === EOF || c === 0x2f || c === 0x5c || c === 0x3f || c === 0x23) {
          if (override === State.None && isDriveLetter(buffer)) {
            // "file://C:/": a drive letter, not a host. The path state
            // takes it from the buffer.
            state = State.Path;
          } else if (buffer === '') {
            url.host = '';
            if (override !== State.None) return url;
            state = State.PathStart;
          } else {
            const host = parseHost(buffer, false);
            if (host === null) return null;
            url.host = host === 'localhost' ? '' : host;
            if (override !== State.None) return url;
            buffer = '';
            state = State.PathStart;
          }
          continue;
        }
        buffer += input[p]!;
        break;

      case State.PathStart:
        if (special) {
          state = State.Path;
          if (c !== 0x2f && c !== 0x5c) continue;
        } else if (override === State.None && c === 0x3f) {
          url.query = '';
          state = State.Query;
        } else if (override === State.None && c === 0x23) {
          url.fragment = '';
          state = State.Fragment;
        } else if (c !== EOF) {
          state = State.Path;
          if (c !== 0x2f) continue;
        } else if (override !== State.None && url.host === null) {
          (url.path as string[]).push('');
        }
        break;

      case State.Path: {
        // One segment at a time: up to what ends it.
        let end = p;
        for (; end < length; end++) {
          const d = input.charCodeAt(end);
          if (
            d === 0x2f ||
            (special && d === 0x5c) ||
            (override === State.None && (d === 0x3f || d === 0x23))
          )
            break;
        }
        buffer += encode(input.slice(p, end), PATH);
        p = end;
        const ending = end < length ? input.charCodeAt(end) : EOF;
        const slash = ending === 0x2f || (special && ending === 0x5c);
        const path = url.path as string[];
        const dots = dotSegment(buffer);
        if (dots === 2) {
          shorten(url);
          if (!slash) path.push('');
        } else if (dots === 1) {
          if (!slash) path.push('');
        } else {
          if (
            url.scheme === 'file' &&
            path.length === 0 &&
            isDriveLetter(buffer)
          )
            buffer = buffer[0]! + ':';
          path.push(buffer);
        }
        buffer = '';
        if (ending === EOF) break loop;
        if (ending === 0x3f) {
          url.query = '';
          state = State.Query;
        } else if (ending === 0x23) {
          url.fragment = '';
          state = State.Fragment;
        }
        break;
      }

      case State.OpaquePath: {
        let end = p;
        for (; end < length; end++) {
          const d = input.charCodeAt(end);
          if (d === 0x3f || d === 0x23) break;
        }
        let part = encode(input.slice(p, end), C0);
        // A space would not survive in front of a query or a fragment.
        if (end < length && part.endsWith(' '))
          part = part.slice(0, -1) + '%20';
        url.path = (url.path as string) + part;
        if (end === length) break loop;
        if (input.charCodeAt(end) === 0x3f) {
          url.query = '';
          state = State.Query;
        } else {
          url.fragment = '';
          state = State.Fragment;
        }
        p = end;
        break;
      }

      case State.Query: {
        let end = override === State.None ? input.indexOf('#', p) : -1;
        if (end < 0) end = length;
        url.query += encode(
          input.slice(p, end),
          special ? SPECIAL_QUERY : QUERY,
        );
        if (end === length) break loop;
        url.fragment = '';
        state = State.Fragment;
        p = end;
        break;
      }

      case State.Fragment:
        url.fragment += encode(input.slice(p), FRAGMENT);
        break loop;
    }
    if (c === EOF) break;
    p++;
  }
  return url;
}

const pathname = (url: UrlRecord): string =>
  typeof url.path === 'string'
    ? url.path
    : url.path.length === 0
      ? ''
      : '/' + url.path.join('/');

function serialize(url: UrlRecord): string {
  let out = url.scheme + ':';
  if (url.host !== null) {
    out += '//';
    if (url.username !== '' || url.password !== '') {
      out += url.username;
      if (url.password !== '') out += ':' + url.password;
      out += '@';
    }
    out += url.host;
    if (url.port !== null) out += ':' + url.port;
  } else if (
    typeof url.path !== 'string' &&
    url.path.length > 1 &&
    url.path[0] === ''
  ) {
    // Without this the path's leading "//" would read as a host.
    out += '/.';
  }
  out += pathname(url);
  if (url.query !== null) out += '?' + url.query;
  if (url.fragment !== null) out += '#' + url.fragment;
  return out;
}

function origin(url: UrlRecord): string {
  switch (url.scheme) {
    case 'http':
    case 'https':
    case 'ws':
    case 'wss':
    case 'ftp':
      return (
        url.scheme +
        '://' +
        url.host +
        (url.port !== null ? ':' + url.port : '')
      );
    case 'blob': {
      // The origin of the URL a blob URL wraps, when that is an HTTP one.
      let inner: UrlRecord | null = null;
      try {
        inner = parse(pathname(url), null);
      } catch {
        // A host that cannot be parsed here: opaque.
      }
      if (
        inner !== null &&
        (inner.scheme === 'http' || inner.scheme === 'https')
      )
        return origin(inner);
    }
  }
  return 'null';
}

// --- application/x-www-form-urlencoded --------------------------------------

/**
 * A string as the standard's interfaces take one: a surrogate without its
 * pair becomes U+FFFD. (ES2024, which the engine has and the `lib` not yet.)
 */
const scalar = (value: unknown): string =>
  (String(value) as string & { toWellFormed(): string }).toWellFormed();

function formDecode(text: string): string {
  const spaced = text.includes('+') ? text.replaceAll('+', ' ') : text;
  return spaced.includes('%')
    ? decodeUtf8(percentDecode(spaced), false)
    : scalar(spaced);
}

function parseForm(input: string): [string, string][] {
  const list: [string, string][] = [];
  if (input === '') return list;
  for (const part of input.split('&')) {
    if (part === '') continue;
    const equals = part.indexOf('=');
    list.push(
      equals < 0
        ? [formDecode(part), '']
        : [
            formDecode(part.slice(0, equals)),
            formDecode(part.slice(equals + 1)),
          ],
    );
  }
  return list;
}

type SearchParamsInit =
  | string
  | Iterable<Iterable<string>>
  | Record<string, string>;

/** Makes `params` the `searchParams` of a URL: filled from its query. */
let link: (params: URLSearchParams, url: UrlRecord) => void;

export class URLSearchParams {
  #list: [string, string][] = [];
  // The URL whose `searchParams` this is: its query follows every change.
  #url: UrlRecord | null = null;

  constructor(init: SearchParamsInit = '') {
    if (typeof init !== 'object' || init === null) {
      const text = String(init);
      this.#list = parseForm(
        text.charCodeAt(0) === 0x3f ? text.slice(1) : text,
      );
    } else if (Symbol.iterator in init) {
      for (const pair of init) {
        const items =
          typeof pair === 'object' && pair !== null ? [...pair] : [];
        if (items.length !== 2)
          throw new TypeError(
            'URLSearchParams: each pair must be an iterable of a name and a value',
          );
        this.#list.push([scalar(items[0]), scalar(items[1])]);
      }
    } else {
      for (const name of Object.keys(init))
        this.#list.push([scalar(name), scalar(init[name])]);
    }
  }

  #update(): void {
    if (this.#url !== null) this.#url.query = this.toString() || null;
  }

  get size(): number {
    return this.#list.length;
  }

  append(name: string, value: string): void {
    this.#list.push([scalar(name), scalar(value)]);
    this.#update();
  }

  delete(name: string, value?: string): void {
    const key = scalar(name);
    const only = value === undefined ? undefined : scalar(value);
    this.#list = this.#list.filter(
      (pair) => pair[0] !== key || (only !== undefined && pair[1] !== only),
    );
    this.#update();
  }

  get(name: string): string | null {
    const key = scalar(name);
    for (const pair of this.#list) if (pair[0] === key) return pair[1];
    return null;
  }

  getAll(name: string): string[] {
    const key = scalar(name);
    const values: string[] = [];
    for (const pair of this.#list) if (pair[0] === key) values.push(pair[1]);
    return values;
  }

  has(name: string, value?: string): boolean {
    const key = scalar(name);
    const only = value === undefined ? undefined : scalar(value);
    return this.#list.some(
      (pair) => pair[0] === key && (only === undefined || pair[1] === only),
    );
  }

  set(name: string, value: string): void {
    const key = scalar(name);
    const first = this.#list.find((pair) => pair[0] === key);
    if (first === undefined) {
      this.#list.push([key, scalar(value)]);
    } else {
      first[1] = scalar(value);
      this.#list = this.#list.filter(
        (pair) => pair === first || pair[0] !== key,
      );
    }
    this.#update();
  }

  /** By name, in code unit order; equal names keep their order. */
  sort(): void {
    this.#list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    this.#update();
  }

  forEach(
    callback: (value: string, name: string, parent: URLSearchParams) => void,
    thisArg?: unknown,
  ): void {
    for (let i = 0; i < this.#list.length; i++) {
      const pair = this.#list[i]!;
      callback.call(thisArg, pair[1], pair[0], this);
    }
  }

  // The iterators read the list as it is when they are advanced.
  *entries(): IterableIterator<[string, string]> {
    for (let i = 0; i < this.#list.length; i++) {
      const pair = this.#list[i]!;
      yield [pair[0], pair[1]];
    }
  }

  *keys(): IterableIterator<string> {
    for (let i = 0; i < this.#list.length; i++) yield this.#list[i]![0];
  }

  *values(): IterableIterator<string> {
    for (let i = 0; i < this.#list.length; i++) yield this.#list[i]![1];
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }

  toString(): string {
    let out = '';
    for (const pair of this.#list)
      out +=
        (out === '' ? '' : '&') +
        encode(pair[0], FORM, true) +
        '=' +
        encode(pair[1], FORM, true);
    return out;
  }

  get [Symbol.toStringTag](): string {
    return 'URLSearchParams';
  }

  static {
    link = (params, url) => {
      params.#url = url;
      params.#list = parseForm(url.query ?? '');
    };
  }
}

// --- URL ----------------------------------------------------------------------

/** No credentials and no port: no host, an empty one, or a `file:` URL. */
const bare = (url: UrlRecord): boolean =>
  url.host === null || url.host === '' || url.scheme === 'file';

export class URL {
  // One record for the life of the object: `searchParams` holds it too.
  readonly #url: UrlRecord;
  #params: URLSearchParams | null = null;

  constructor(url: string | URL, base?: string | URL) {
    if (arguments.length === 0)
      throw new TypeError('URL: the url argument is required');
    let against: UrlRecord | null = null;
    if (base !== undefined) {
      against =
        typeof base === 'object' && base !== null && #url in base
          ? base.#url
          : parse(String(base), null);
      if (against === null)
        throw new TypeError(`URL: "${String(base)}" is not a valid base URL`);
    }
    const record = parse(String(url), against);
    if (record === null)
      throw new TypeError(`URL: "${String(url)}" is not a valid URL`);
    this.#url = record;
  }

  static canParse(url: string | URL, base?: string | URL): boolean {
    return URL.parse(url, base) !== null;
  }

  static parse(url: string | URL, base?: string | URL): URL | null {
    try {
      return new URL(url, base);
    } catch {
      return null;
    }
  }

  static createObjectURL(_object: unknown): string {
    throw new Error(
      'URL.createObjectURL: object URLs are not implemented by the desktop host',
    );
  }

  static revokeObjectURL(_url: string): void {
    throw new Error(
      'URL.revokeObjectURL: object URLs are not implemented by the desktop host',
    );
  }

  get href(): string {
    return serialize(this.#url);
  }
  set href(value: string) {
    const record = parse(String(value), null);
    if (record === null)
      throw new TypeError(`URL: "${String(value)}" is not a valid URL`);
    Object.assign(this.#url, record);
    if (this.#params !== null) link(this.#params, this.#url);
  }

  get origin(): string {
    return origin(this.#url);
  }

  get protocol(): string {
    return this.#url.scheme + ':';
  }
  set protocol(value: string) {
    parse(String(value) + ':', null, this.#url, State.SchemeStart);
  }

  get username(): string {
    return this.#url.username;
  }
  set username(value: string) {
    if (!bare(this.#url)) this.#url.username = encode(String(value), USERINFO);
  }

  get password(): string {
    return this.#url.password;
  }
  set password(value: string) {
    if (!bare(this.#url)) this.#url.password = encode(String(value), USERINFO);
  }

  get host(): string {
    const url = this.#url;
    return url.host === null
      ? ''
      : url.port === null
        ? url.host
        : url.host + ':' + url.port;
  }
  set host(value: string) {
    if (typeof this.#url.path !== 'string')
      parse(String(value), null, this.#url, State.Host);
  }

  get hostname(): string {
    return this.#url.host ?? '';
  }
  set hostname(value: string) {
    if (typeof this.#url.path !== 'string')
      parse(String(value), null, this.#url, State.Hostname);
  }

  get port(): string {
    return this.#url.port === null ? '' : String(this.#url.port);
  }
  set port(value: string) {
    if (bare(this.#url)) return;
    const text = String(value);
    if (text === '') this.#url.port = null;
    else parse(text, null, this.#url, State.Port);
  }

  get pathname(): string {
    return pathname(this.#url);
  }
  set pathname(value: string) {
    if (typeof this.#url.path === 'string') return;
    this.#url.path = [];
    parse(String(value), null, this.#url, State.PathStart);
  }

  get search(): string {
    return this.#url.query ? '?' + this.#url.query : '';
  }
  set search(value: string) {
    const text = String(value);
    if (text === '') {
      this.#url.query = null;
    } else {
      this.#url.query = '';
      parse(
        text.charCodeAt(0) === 0x3f ? text.slice(1) : text,
        null,
        this.#url,
        State.Query,
      );
    }
    if (this.#params !== null) link(this.#params, this.#url);
  }

  /** Made when first asked for; from then on it and the query follow each other. */
  get searchParams(): URLSearchParams {
    if (this.#params === null) {
      this.#params = new URLSearchParams();
      link(this.#params, this.#url);
    }
    return this.#params;
  }

  get hash(): string {
    return this.#url.fragment ? '#' + this.#url.fragment : '';
  }
  set hash(value: string) {
    const text = String(value);
    if (text === '') {
      this.#url.fragment = null;
      return;
    }
    this.#url.fragment = '';
    parse(
      text.charCodeAt(0) === 0x23 ? text.slice(1) : text,
      null,
      this.#url,
      State.Fragment,
    );
  }

  toString(): string {
    return this.href;
  }

  toJSON(): string {
    return this.href;
  }

  get [Symbol.toStringTag](): string {
    return 'URL';
  }
}
