// Device boundary for the SceneGraph fixture. The renderer and Solid are real.
export type Group = { children: Group[]; type: string };
export function createElement(type: string): Group {
  return { type, children: [] };
}
export function insertNode(parent: Group, child: Group) {
  parent.children.push(child);
}
export function setProp(node: Group, key: string, value: unknown) {
  Reflect.set(node, key, value);
}
export const tmTransaction = {
  removeNode(parent: Group, child: Group) {
    const index = parent.children.indexOf(child);
    if (index >= 0) parent.children.splice(index, 1);
  },
};
