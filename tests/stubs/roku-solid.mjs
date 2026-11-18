// Minimal @roku-sdk/solid stand-in for exercising the Roku video adapter.
export const created = [];
export function createElement(type) {
  const node = { type, props: {}, children: [] };
  created.push(node);
  return node;
}
export function setProp(node, key, value) {
  node.props[key] = value;
  if (key === 'control' && value === 'play') node.props.onState?.('playing');
}
export function insertNode(parent, node) {
  parent.children.push(node);
}
export const tmTransaction = {
  removeNode(parent, node) {
    const index = parent.children.indexOf(node);
    if (index >= 0) parent.children.splice(index, 1);
  },
};
