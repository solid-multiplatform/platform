import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Stage } from '../dist/canvas/src/core/Stage.js';

// Real Canvas nodes on a stage that only counts what a child-order change
// asks of it: no canvas, loop or renderer is needed to link nodes.
const scene = () => {
  const stage = {
    defShaderNode: {},
    renders: 0,
    listUpdates: 0,
    resolveNodeDefaults: Stage.prototype.resolveNodeDefaults,
    requestRender() {
      this.renders++;
    },
    requestRenderListUpdate() {
      this.listUpdates++;
    },
  };
  const node = (name, parent = null, zIndex = 0) => {
    const created = Stage.prototype.createNode.call(stage, { parent, zIndex });
    created.name = name;
    return created;
  };
  return { stage, node };
};

const names = (parent) => parent.children.map((child) => child.name).join('');

test('insertBefore(child, null) appends', () => {
  const { node } = scene();
  const root = node('root');
  const a = node('a', root);
  const b = node('b');
  root.insertBefore(b, null);
  assert.equal(names(root), 'ab');
  assert.equal(b.parent, root);
  const c = node('c');
  root.insertBefore(c, null);
  assert.equal(names(root), 'abc');
  // An anchor that is not a child of this node appends too.
  const d = node('d');
  root.insertBefore(d, node('stranger'));
  assert.equal(names(root), 'abcd');
  assert.equal(a.parent, root);
});

test('insertBefore places a new child before the anchor', () => {
  const { node } = scene();
  const root = node('root');
  const a = node('a', root);
  const b = node('b', root);
  const c = node('c');
  root.insertBefore(c, b);
  assert.equal(names(root), 'acb');
  const d = node('d');
  root.insertBefore(d, a);
  assert.equal(names(root), 'dacb');
  assert.equal(c.parent, root);
  assert.equal(d.parent, root);
});

test('insertBefore moves a child within its parent, in place', () => {
  const { stage, node } = scene();
  const root = node('root');
  const a = node('a', root);
  const b = node('b', root);
  const c = node('c', root);
  const d = node('d', root);
  const list = root.children;

  root.insertBefore(d, a);
  assert.equal(names(root), 'dabc');
  root.insertBefore(d, c);
  assert.equal(names(root), 'abdc');
  root.insertBefore(a, null);
  assert.equal(names(root), 'bdca');
  root.insertBefore(c, b);
  assert.equal(names(root), 'cbda');
  assert.equal(root.children, list);
  assert.equal(list.length, 4);
  assert.equal(d.parent, root);

  // Already in place: before its next sibling, before itself, last to the end.
  stage.listUpdates = 0;
  stage.renders = 0;
  root.insertBefore(b, d);
  root.insertBefore(b, b);
  root.insertBefore(a, null);
  assert.equal(names(root), 'cbda');
  assert.equal(stage.listUpdates, 0);
  assert.equal(stage.renders, 0);

  // A move redraws in the new order.
  root.insertBefore(a, c);
  assert.equal(names(root), 'acbd');
  assert.equal(stage.listUpdates, 1);
});

test('insertBefore re-parents a child of another node', () => {
  const { node } = scene();
  const root = node('root');
  const left = node('left', root);
  const right = node('right', root);
  const a = node('a', left);
  const b = node('b', left);
  const x = node('x', right);
  const y = node('y', right);

  right.insertBefore(a, y);
  assert.equal(names(left), 'b');
  assert.equal(names(right), 'xay');
  assert.equal(a.parent, right);

  right.insertBefore(b, null);
  assert.equal(names(left), '');
  assert.equal(names(right), 'xayb');
  assert.equal(b.parent, right);

  // Before itself, from another parent: there is no place to keep, so append.
  left.insertBefore(x, x);
  assert.equal(names(left), 'x');
  assert.equal(names(right), 'ayb');
  assert.equal(x.parent, left);
});

test('insertBefore keeps siblings sorted by zIndex, ties in child order', () => {
  const { node } = scene();
  const root = node('root');
  const a = node('a', root);
  const b = node('b', root);
  const top = node('T', root, 1);
  assert.equal(names(root), 'abT');

  // Equal zIndex: exactly where it was put.
  const c = node('c');
  root.insertBefore(c, a);
  assert.equal(names(root), 'cabT');

  // A higher zIndex put first goes to the nearest place that is sorted.
  const high = node('H', null, 1);
  root.insertBefore(high, c);
  assert.equal(names(root), 'cabHT');

  // A lower zIndex put last likewise.
  root.insertBefore(b, null);
  assert.equal(names(root), 'cabHT');
  root.insertBefore(c, null);
  assert.equal(names(root), 'abcHT');
  root.insertBefore(top, high);
  assert.equal(names(root), 'abcTH');
});

test('insertBefore does nothing with a destroyed node or itself', () => {
  const { stage, node } = scene();
  stage.untrackTimedNode = () => {};
  const root = node('root');
  const a = node('a', root);
  const gone = node('gone');
  gone.destroy();
  root.insertBefore(gone, a);
  assert.equal(names(root), 'a');
  assert.equal(gone.parent, null);
  root.insertBefore(root, a);
  assert.equal(names(root), 'a');
  assert.equal(root.parent, null);

  const parent = node('parent');
  parent.destroy();
  parent.insertBefore(a, null);
  assert.equal(a.parent, root);
  assert.equal(names(root), 'a');
});
