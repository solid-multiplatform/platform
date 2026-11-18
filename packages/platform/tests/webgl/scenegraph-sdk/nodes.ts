// Device boundary for the SceneGraph fixture. The renderer and Solid are real.
// `effect` and `maskGroup` are node types like the rest: an Effect is created
// here and referred to through a Rectangle's or Poster's `effect` field.
export type Group = { children: Group[]; type: string };
export function createElement(type: string): Group {
  return { type, children: [] };
}
/** Appends, or inserts before `anchor`. A node that is already a child moves. */
export function insertNode(parent: Group, child: Group, anchor?: Group) {
  const from = parent.children.indexOf(child);
  if (from >= 0) parent.children.splice(from, 1);
  const at = anchor ? parent.children.indexOf(anchor) : -1;
  if (at < 0) parent.children.push(child);
  else parent.children.splice(at, 0, child);
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
