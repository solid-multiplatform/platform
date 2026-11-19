// `DOMException` (Web IDL): an Error with a name and, for the names that had
// one before names existed, a legacy numeric code.

// The legacy constants, at the index that is their code; a hole is a code
// that never had one.
const LEGACY = [
  '',
  'INDEX_SIZE_ERR',
  'DOMSTRING_SIZE_ERR',
  'HIERARCHY_REQUEST_ERR',
  'WRONG_DOCUMENT_ERR',
  'INVALID_CHARACTER_ERR',
  'NO_DATA_ALLOWED_ERR',
  'NO_MODIFICATION_ALLOWED_ERR',
  'NOT_FOUND_ERR',
  'NOT_SUPPORTED_ERR',
  'INUSE_ATTRIBUTE_ERR',
  'INVALID_STATE_ERR',
  'SYNTAX_ERR',
  'INVALID_MODIFICATION_ERR',
  'NAMESPACE_ERR',
  'INVALID_ACCESS_ERR',
  'VALIDATION_ERR',
  'TYPE_MISMATCH_ERR',
  'SECURITY_ERR',
  'NETWORK_ERR',
  'ABORT_ERR',
  'URL_MISMATCH_ERR',
  'QUOTA_EXCEEDED_ERR',
  'TIMEOUT_ERR',
  'INVALID_NODE_TYPE_ERR',
  'DATA_CLONE_ERR',
];

// The names that have a code. The rest (`EncodingError`, `NotAllowedError`,
// ...) have code 0.
const CODES: Record<string, number> = {
  IndexSizeError: 1,
  HierarchyRequestError: 3,
  WrongDocumentError: 4,
  InvalidCharacterError: 5,
  NoModificationAllowedError: 7,
  NotFoundError: 8,
  NotSupportedError: 9,
  InUseAttributeError: 10,
  InvalidStateError: 11,
  SyntaxError: 12,
  InvalidModificationError: 13,
  NamespaceError: 14,
  InvalidAccessError: 15,
  TypeMismatchError: 17,
  SecurityError: 18,
  NetworkError: 19,
  AbortError: 20,
  URLMismatchError: 21,
  QuotaExceededError: 22,
  TimeoutError: 23,
  InvalidNodeTypeError: 24,
  DataCloneError: 25,
};

export class DOMException extends Error {
  readonly code: number;

  constructor(message = '', name = 'Error') {
    super(String(message));
    // An own property, where the standard has a getter on the prototype:
    // what Error's own machinery (`toString`, the stack's first line) reads.
    Object.defineProperty(this, 'name', {
      value: String(name),
      writable: true,
      configurable: true,
    });
    this.code = Object.hasOwn(CODES, this.name) ? CODES[this.name]! : 0;
  }

  get [Symbol.toStringTag](): string {
    return 'DOMException';
  }
}

// `DOMException.ABORT_ERR` and `exception.ABORT_ERR`, as the standard has
// them: on the constructor and on the prototype.
for (let code = 1; code < LEGACY.length; code++) {
  const constant = { value: code, enumerable: true };
  Object.defineProperty(DOMException, LEGACY[code]!, constant);
  Object.defineProperty(DOMException.prototype, LEGACY[code]!, constant);
}
