// Minimal @roku-sdk/solid stand-in for exercising the Roku video adapter.
export const created = [];

export function createElement(type) {
  const node = { type, props: {}, children: [], parent: undefined };
  created.push(node);
  return node;
}

export function setProp(node, key, value) {
  if (value === undefined) {
    delete node.props[key];
    return;
  }
  node.props[key] = value;
  // The firmware reports buffering readiness for `prebuffer`; the adapter's
  // prepare resolves on it. Tests raise every later state by hand.
  if (key === 'control' && value === 'prebuffer')
    queueMicrotask(() => node.props.onState?.('paused'));
  if (key === 'control' && value === 'play')
    queueMicrotask(() => node.props.onState?.('playing'));
}

export function insertNode(parent, node, anchor) {
  node.parent = parent;
  const at = anchor ? parent.children.indexOf(anchor) : -1;
  if (at === -1) parent.children.push(node);
  else parent.children.splice(at, 0, node);
}

export const tmTransaction = {
  removeNode(parent, node) {
    const index = parent.children.indexOf(node);
    if (index >= 0) parent.children.splice(index, 1);
    node.parent = undefined;
  },
};
