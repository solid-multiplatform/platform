// The device boundary of the Roku backend, for tests in plain Node: the calls
// roku/*.ts makes on `@roku-sdk/solid` and `@roku-sdk/rsg-ts/runtime`.
// A node records the fields written to it in `props`; nothing is drawn.
let nextRef = 1;

export function createElement(type) {
  return { type, r: nextRef++, props: {}, children: [], parent: null };
}

export function setProp(node, name, value) {
  node.props[name] = value;
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

export function getFontMeasure() {
  return {
    getOneLineWidth: (_ref, text) => text.length * 16,
    getOneLineHeight: () => 32,
    getAscent: () => 24,
    getDescent: () => 8,
  };
}

export async function whenFontReady() {}
