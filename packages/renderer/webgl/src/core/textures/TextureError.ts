export enum TextureErrorCode {
  MEMORY_THRESHOLD_EXCEEDED = 'MEMORY_THRESHOLD_EXCEEDED',
  TEXTURE_DATA_NULL = 'TEXTURE_DATA_NULL',
  TEXTURE_TYPE_NOT_REGISTERED = 'TEXTURE_TYPE_NOT_REGISTERED',
  TEXTURE_UPLOAD_FAILED = 'TEXTURE_UPLOAD_FAILED',
}

const defaultMessages: Record<TextureErrorCode, string> = {
  [TextureErrorCode.MEMORY_THRESHOLD_EXCEEDED]: 'Memory threshold exceeded',
  [TextureErrorCode.TEXTURE_DATA_NULL]: 'Texture data is null',
  [TextureErrorCode.TEXTURE_TYPE_NOT_REGISTERED]:
    'Texture type is not registered',
  [TextureErrorCode.TEXTURE_UPLOAD_FAILED]: 'Texture upload failed',
};

export class TextureError extends Error {
  code?: TextureErrorCode;

  constructor(message: string);
  constructor(code: TextureErrorCode, message?: string);
  constructor(codeOrMessage: TextureErrorCode | string, maybeMessage?: string) {
    // `defaultMessages` is keyed by every `TextureErrorCode` value, so an own
    // property check tests the same membership as
    // `Object.values(TextureErrorCode).includes` without allocating an array
    // and without needing `Object.values` (Chrome 54, above the Chrome 38
    // floor). Not `in`: it also matches inherited names, making `'toString'`
    // a code.
    const isCode = Object.prototype.hasOwnProperty.call(
      defaultMessages,
      codeOrMessage,
    );

    const code = isCode ? (codeOrMessage as TextureErrorCode) : undefined;
    let message: string;
    if (isCode && code) {
      message = maybeMessage ?? defaultMessages[code];
    } else {
      message = String(codeOrMessage);
    }

    super(message);
    // Not `new.target.name`: that becomes a minified, unstable identifier in
    // production bundles, which breaks the duck-typed `isTextureError`
    // fallback below (it matches on the literal string `'TextureError'`).
    this.name = 'TextureError';
    if (code) this.code = code;
  }
}

export function isTextureError(err: unknown): err is TextureError {
  return (
    err instanceof TextureError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { name?: unknown }).name === 'TextureError' &&
      typeof (err as { code?: unknown }).code === 'string')
  );
}
