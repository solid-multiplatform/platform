// `structuredClone` (HTML Standard, "structured serialize" and "structured
// deserialize" in one pass over the value).
//
// Not implemented: transferring (`options.transfer` with anything in it
// throws by name). An object whose `Symbol.toStringTag` names something
// other than the types below is refused rather than copied as a plain
// object: that is what tells the platform's own objects (`URL`, `Headers`,
// ...), which the standard refuses, from an app's.
import { DOMException } from './dom-exception.js';

type Seen = Map<object, object>;

const ERRORS: Record<string, ErrorConstructor> = {
  Error,
  EvalError,
  RangeError,
  ReferenceError,
  SyntaxError,
  TypeError,
  URIError,
};

const refuse = (what: string): never => {
  throw new DOMException(
    `structuredClone: ${what} cannot be cloned`,
    'DataCloneError',
  );
};

const tagOf = (value: object): string =>
  Object.prototype.toString.call(value).slice(8, -1);

/** A data property of an error, as the standard reads them: no getters. */
function ownData(error: object, name: string): unknown {
  const property = Object.getOwnPropertyDescriptor(error, name);
  return property !== undefined && 'value' in property
    ? property.value
    : undefined;
}

function cloneError(error: Error, seen: Seen): Error {
  const message = ownData(error, 'message');
  const text = message === undefined ? undefined : String(message);
  let copy: Error;
  if (error instanceof DOMException) {
    copy = new DOMException(text, error.name);
  } else {
    const name = String(error.name);
    copy = new (Object.hasOwn(ERRORS, name) ? ERRORS[name]! : Error)(text);
  }
  seen.set(error, copy);
  // The stack of the original, not of this call.
  if (typeof error.stack === 'string')
    Object.defineProperty(copy, 'stack', {
      value: error.stack,
      writable: true,
      configurable: true,
    });
  if (Object.hasOwn(error, 'cause'))
    Object.defineProperty(copy, 'cause', {
      value: clone(ownData(error, 'cause'), seen),
      writable: true,
      configurable: true,
    });
  return copy;
}

function clone(value: unknown, seen: Seen): unknown {
  if (typeof value !== 'object' || value === null) {
    if (typeof value === 'function') refuse('a function');
    if (typeof value === 'symbol') refuse('a symbol');
    return value;
  }
  const known = seen.get(value);
  if (known !== undefined) return known;

  const remember = <T extends object>(copy: T): T => {
    seen.set(value, copy);
    return copy;
  };
  let copy: Record<string, unknown>;
  if (Array.isArray(value)) {
    copy = remember(new Array(value.length)) as unknown as typeof copy;
  } else {
    const tag = tagOf(value);
    switch (tag) {
      case 'Object':
        copy = remember({});
        break;
      case 'Boolean':
        return remember(Object(Boolean.prototype.valueOf.call(value)));
      case 'Number':
        return remember(Object(Number.prototype.valueOf.call(value)));
      case 'String':
        return remember(Object(String.prototype.valueOf.call(value)));
      case 'BigInt':
        return remember(Object(BigInt.prototype.valueOf.call(value)));
      case 'Date':
        return remember(new Date(Date.prototype.getTime.call(value)));
      case 'RegExp': {
        const { source, flags } = value as RegExp;
        return remember(new RegExp(source, flags));
      }
      case 'ArrayBuffer':
        return remember((value as ArrayBuffer).slice(0));
      case 'Error':
        return cloneError(value as Error, seen);
      case 'Map': {
        const map = remember(new Map<unknown, unknown>());
        // The entries as they are now: cloning runs no code of the value's,
        // but a getter met on the way may change the map.
        for (const [key, item] of [...(value as Map<unknown, unknown>)])
          map.set(clone(key, seen), clone(item, seen));
        return map;
      }
      case 'Set': {
        const set = remember(new Set<unknown>());
        for (const item of [...(value as Set<unknown>)])
          set.add(clone(item, seen));
        return set;
      }
      default: {
        if (!ArrayBuffer.isView(value)) return refuse(`a ${tag}`);
        // Views of one buffer stay views of one buffer.
        const buffer = clone(value.buffer, seen) as ArrayBuffer;
        const View = (globalThis as unknown as Record<string, unknown>)[
          tag
        ] as new (b: ArrayBuffer, offset: number, length: number) => object;
        return remember(
          new View(
            buffer,
            value.byteOffset,
            tag === 'DataView'
              ? value.byteLength
              : (value as Uint8Array).length,
          ),
        );
      }
    }
  }
  // An array or an ordinary object, an instance of a class included: its
  // own enumerable string-keyed properties, on a plain array or object.
  for (const key of Object.keys(value)) {
    const item = clone((value as Record<string, unknown>)[key], seen);
    // Defined, not assigned: "__proto__" is a property like any other.
    if (key === '__proto__')
      Object.defineProperty(copy, key, {
        value: item,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    else copy[key] = item;
  }
  return copy;
}

export function structuredClone<T>(
  value: T,
  options?: { transfer?: Iterable<unknown> },
): T {
  const transfer = options?.transfer;
  if (transfer !== undefined && Array.from(transfer).length > 0)
    throw new Error(
      'structuredClone: transfer is not implemented by the desktop host',
    );
  return clone(value, new Map()) as T;
}
