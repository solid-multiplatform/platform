// Runs before the app's script: the parts of the runtime that are easier to
// say in JavaScript. `host` is `__solid`.
(function (host) {
  'use strict';

  function describe(value, nested) {
    if (typeof value === 'string')
      return nested ? JSON.stringify(value) : value;
    if (typeof value === 'function')
      return '[Function ' + (value.name || 'anonymous') + ']';
    if (value === null || typeof value !== 'object') return String(value);
    if (value instanceof Error) return value.stack || String(value);
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer)
      return (
        '[' + value.constructor.name + ' of ' + value.byteLength + ' bytes]'
      );
    var seen = [];
    try {
      return JSON.stringify(value, function (key, item) {
        if (item !== null && typeof item === 'object') {
          if (seen.indexOf(item) !== -1) return '[Circular]';
          seen.push(item);
        } else if (typeof item === 'function') {
          return describe(item, true);
        } else if (typeof item === 'bigint') {
          return String(item) + 'n';
        }
        return item;
      });
    } catch {
      // A getter or toJSON threw: the object's tag says what it was.
      return Object.prototype.toString.call(value);
    }
  }

  function writer(stream) {
    return function () {
      var text = '';
      for (var i = 0; i < arguments.length; i++)
        text += (i === 0 ? '' : ' ') + describe(arguments[i], false);
      host.write(stream, text + '\n');
    };
  }

  var out = writer(1);
  var err = writer(2);
  globalThis.console = {
    log: out,
    info: out,
    debug: out,
    warn: err,
    error: err,
  };

  // A rejection nothing handled is a bug that would otherwise pass in
  // silence. Hermes reports it from a timer of its own once the promise has
  // had time to be handled; nothing runs while every promise is.
  HermesInternal.enablePromiseRejectionTracker({
    allRejections: true,
    onUnhandled: function (id, reason) {
      host.write(
        2,
        'Unhandled promise rejection: ' + describe(reason, false) + '\n',
      );
    },
    onHandled: function () {},
  });
})(__solid);
