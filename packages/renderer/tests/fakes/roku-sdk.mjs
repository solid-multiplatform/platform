// The device boundary of the Roku backend, for tests in plain Node: the calls
// roku/*.ts makes on `@roku-sdk/solid` and `@roku-sdk/rsg-ts/runtime`.
// A node records the fields written to it in `props`; nothing is drawn.
let nextRef = 1;

/** How many nodes of each type have been created, for tests that count them. */
export const created = {};

export function createElement(type) {
  created[type] = (created[type] || 0) + 1;
  const node = { type, r: nextRef++, props: {}, children: [], parent: null };
  if (type === 'font') trackFont(node);
  return node;
}

export function setProp(node, name, value) {
  node.props[name] = value;
  if (node.type === 'font' && name === 'uri') trackFont(node);
}

function detach(node) {
  const parent = node.parent;
  if (!parent) return;
  const index = parent.children.indexOf(node);
  if (index >= 0) parent.children.splice(index, 1);
  node.parent = null;
}

export function insertNode(parent, node, anchor) {
  detach(node);
  const at = anchor ? parent.children.indexOf(anchor) : -1;
  if (at < 0) parent.children.push(node);
  else parent.children.splice(at, 0, node);
  node.parent = parent;
}

export const tmTransaction = {
  removeNode(parent, node) {
    if (node.parent === parent) detach(node);
  },
};

export async function getAppMemoryMonitor() {
  return null;
}

/** What `getDeviceInfo()` reports. A test replaces `device.info` before it makes a renderer. */
export const device = {
  info: { osVersion: { major: '16', minor: '0' }, graphicsPlatform: 'opengl' },
};

export function getDeviceInfo() {
  return device.info;
}

/**
 * How the fake device loads fonts. A Font node can be measured once it has a
 * `uri` that is not in `missing` and `delay` ms have passed since the uri was
 * written, as on a Roku: before that getOneLineHeight is 0 and the rest throw.
 * `polls` counts whenFontReady's checks.
 */
export const fonts = { missing: new Set(), delay: 0, polls: 0 };

const fontNodes = new Map();
const writtenAt = new WeakMap();

function measurable(ref) {
  const node = fontNodes.get(ref);
  // A ref that is not a Font node made here: measurable, as the fake always was.
  if (!node) return true;
  const uri = node.props.uri;
  return typeof uri === 'string' && !fonts.missing.has(uri) && Date.now() - writtenAt.get(node) >= fonts.delay;
}

/** A Font node, tracked so that its readiness can be asked by ref; stamped again when its uri is written. */
function trackFont(node) {
  fontNodes.set(node.r, node);
  writtenAt.set(node, Date.now());
}

export function getFontMeasure() {
  const need = (ref) => {
    if (!measurable(ref)) throw new Error('Font is not yet loaded');
  };
  return {
    getOneLineWidth: (ref, text) => (need(ref), text.length * 16),
    getOneLineHeight: (ref) => (measurable(ref) ? 32 : 0),
    getAscent: (ref) => (need(ref), 24),
    getDescent: (ref) => (need(ref), 8),
  };
}

/**
 * The SDK's device implementation in small: resolves on a microtask when the
 * font is measurable, else polls on a timer until it is. An abort signal with
 * listeners stops the poll at once; one without is noticed at the next poll.
 */
export function whenFontReady(ref, options) {
  const signal = options?.signal;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('Aborted'));
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener?.('abort', onAbort);
      reject(signal.reason ?? new Error('Aborted'));
    };
    signal?.addEventListener?.('abort', onAbort);
    const poll = () => {
      fonts.polls++;
      if (signal?.aborted) return onAbort();
      if (!measurable(ref)) {
        timer = setTimeout(poll, 16);
        return;
      }
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    };
    if (measurable(ref)) void Promise.resolve().then(poll);
    else timer = setTimeout(poll, 16);
  });
}
