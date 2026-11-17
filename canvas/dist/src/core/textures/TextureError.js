export var TextureErrorCode;
(function (TextureErrorCode) {
    TextureErrorCode["MEMORY_THRESHOLD_EXCEEDED"] = "MEMORY_THRESHOLD_EXCEEDED";
    TextureErrorCode["TEXTURE_DATA_NULL"] = "TEXTURE_DATA_NULL";
    TextureErrorCode["TEXTURE_TYPE_NOT_REGISTERED"] = "TEXTURE_TYPE_NOT_REGISTERED";
    TextureErrorCode["TEXTURE_UPLOAD_FAILED"] = "TEXTURE_UPLOAD_FAILED";
})(TextureErrorCode || (TextureErrorCode = {}));
const defaultMessages = {
    [TextureErrorCode.MEMORY_THRESHOLD_EXCEEDED]: 'Memory threshold exceeded',
    [TextureErrorCode.TEXTURE_DATA_NULL]: 'Texture data is null',
    [TextureErrorCode.TEXTURE_TYPE_NOT_REGISTERED]: 'Texture type is not registered',
    [TextureErrorCode.TEXTURE_UPLOAD_FAILED]: 'Texture upload failed',
};
export class TextureError extends Error {
    constructor(codeOrMessage, maybeMessage) {
        // `defaultMessages` is keyed by every `TextureErrorCode` value, so an own
        // property check tests the same membership as
        // `Object.values(TextureErrorCode).includes` without allocating an array
        // and without needing `Object.values` (Chrome 54, above the Chrome 38
        // floor). Not `in`: it also matches inherited names, making `'toString'`
        // a code.
        const isCode = Object.prototype.hasOwnProperty.call(defaultMessages, codeOrMessage);
        const code = isCode ? codeOrMessage : undefined;
        let message;
        if (isCode && code) {
            message = maybeMessage ?? defaultMessages[code];
        }
        else {
            message = String(codeOrMessage);
        }
        super(message);
        // Not `new.target.name`: that becomes a minified, unstable identifier in
        // production bundles, which breaks the duck-typed `isTextureError`
        // fallback below (it matches on the literal string `'TextureError'`).
        this.name = 'TextureError';
        if (code)
            this.code = code;
    }
}
export function isTextureError(err) {
    return (err instanceof TextureError ||
        (typeof err === 'object' &&
            err !== null &&
            err.name === 'TextureError' &&
            typeof err.code === 'string'));
}
//# sourceMappingURL=TextureError.js.map