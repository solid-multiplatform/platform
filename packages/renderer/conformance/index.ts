/**
 * Behaviour every scene backend must share, checked through the contract
 * alone. A backend's test file builds a {@link ConformanceHarness} and runs
 * each returned case with its own test runner:
 *
 *   for (const c of sceneConformance(harness)) test(c.name, c.run);
 *
 * The cases use no test-runner API, so the same list runs under Vitest in a
 * browser, Vitest in jsdom, node:test and Jest.
 */
import {
  RenderState,
  type SceneNode,
  type SceneRenderer,
  type SceneTextNode,
} from '../contracts.js';

export interface ConformanceHarness {
  /** A fresh renderer with an empty root. */
  create(): SceneRenderer;
  /** Resolves once the backend has applied pending updates (a frame). */
  settle(): Promise<void>;
  /**
   * The children of `node` in paint order for equal zIndex. The contract has
   * no child list, so each backend reads its own.
   */
  childrenOf(node: SceneNode): SceneNode[];
  /**
   * How many frame or timer callbacks the backend has scheduled so far. When
   * given, an idle scene must not add to it.
   */
  scheduled?(): number;
}

export interface ConformanceCase {
  name: string;
  run(): Promise<void>;
}

function fail(message: string): never {
  throw new Error('scene conformance: ' + message);
}
function equal(actual: unknown, expected: unknown, what: string): void {
  if (actual !== expected)
    fail(`${what}: expected ${String(expected)}, got ${String(actual)}`);
}
function order(
  h: ConformanceHarness,
  parent: SceneNode,
  expected: SceneNode[],
  what: string,
): void {
  const actual = h.childrenOf(parent);
  const same =
    actual.length === expected.length &&
    actual.every((node, i) => node === expected[i]);
  if (!same)
    fail(
      `${what}: paint order is [${actual.map((n) => n.x).join(', ')}], expected [${expected.map((n) => n.x).join(', ')}] (by x)`,
    );
}

export function sceneConformance(h: ConformanceHarness): ConformanceCase[] {
  const cases: ConformanceCase[] = [];
  const add = (
    name: string,
    body: (renderer: SceneRenderer) => Promise<void> | void,
  ) =>
    cases.push({
      name,
      async run() {
        const renderer = h.create();
        try {
          await body(renderer);
        } finally {
          renderer.destroy();
        }
      },
    });
  // Children carry their index in `x` so a wrong order prints readably.
  const box = (renderer: SceneRenderer, parent: SceneNode | null, x: number) =>
    renderer.createNode({ x, y: 0, w: 10, h: 10, color: 0xffffffff, parent });

  add('a node reads back the props it was created with', (renderer) => {
    const node = renderer.createNode({
      x: 12,
      y: 34,
      w: 56,
      h: 78,
      alpha: 0.5,
      color: 0x11223344,
      zIndex: 3,
      parent: renderer.root,
    });
    equal(node.x, 12, 'x');
    equal(node.y, 34, 'y');
    equal(node.w, 56, 'w');
    equal(node.h, 78, 'h');
    equal(node.alpha, 0.5, 'alpha');
    equal(node.color, 0x11223344, 'color');
    equal(node.zIndex, 3, 'zIndex');
    equal(node.parent, renderer.root, 'parent');
  });

  add('a prop write reads back', (renderer) => {
    const node = box(renderer, renderer.root, 0);
    node.x = 40;
    node.alpha = 0.25;
    node.color = 0xff0000ff;
    equal(node.x, 40, 'x');
    equal(node.alpha, 0.25, 'alpha');
    equal(node.color, 0xff0000ff, 'color');
  });

  add('mount, pivot and scale shorthands set both axes', (renderer) => {
    const node = box(renderer, renderer.root, 0);
    node.mount = 0.5;
    equal(node.mountX, 0.5, 'mountX');
    equal(node.mountY, 0.5, 'mountY');
    node.pivot = 0.25;
    equal(node.pivotX, 0.25, 'pivotX');
    equal(node.pivotY, 0.25, 'pivotY');
    node.scale = 2;
    equal(node.scaleX, 2, 'scaleX');
    equal(node.scaleY, 2, 'scaleY');
  });

  add('children created with a parent paint in creation order', (renderer) => {
    const parent = box(renderer, renderer.root, 0);
    const a = box(renderer, parent, 1);
    const b = box(renderer, parent, 2);
    const c = box(renderer, parent, 3);
    order(h, parent, [a, b, c], 'after creation');
  });

  add('insertBefore appends, inserts and moves', (renderer) => {
    const parent = box(renderer, renderer.root, 0);
    const a = box(renderer, parent, 1);
    const b = box(renderer, parent, 2);
    const c = box(renderer, null, 3);
    parent.insertBefore(c, null);
    equal(c.parent, parent, 'appended child parent');
    order(h, parent, [a, b, c], 'append');
    const d = box(renderer, null, 4);
    parent.insertBefore(d, b);
    order(h, parent, [a, d, b, c], 'insert before a sibling');
    parent.insertBefore(c, a);
    order(h, parent, [c, a, d, b], 'move to the front');
    parent.insertBefore(c, null);
    order(h, parent, [a, d, b, c], 'move to the end');
  });

  add('insertBefore takes a child from another parent', (renderer) => {
    const first = box(renderer, renderer.root, 0);
    const second = box(renderer, renderer.root, 0);
    const a = box(renderer, first, 1);
    const b = box(renderer, second, 2);
    second.insertBefore(a, b);
    equal(a.parent, second, 'parent after the move');
    order(h, first, [], 'old parent');
    order(h, second, [a, b], 'new parent');
  });

  add('a destroyed node leaves its parent', async (renderer) => {
    const parent = box(renderer, renderer.root, 0);
    const a = box(renderer, parent, 1);
    const b = box(renderer, parent, 2);
    a.destroy();
    await h.settle();
    order(h, parent, [b], 'after destroy');
  });

  add('absX and absY add every ancestor offset', async (renderer) => {
    const parent = renderer.createNode({
      x: 100,
      y: 20,
      w: 200,
      h: 200,
      parent: renderer.root,
    });
    const child = renderer.createNode({ x: 5, y: 7, w: 10, h: 10, parent });
    await h.settle();
    equal(child.absX, 105, 'absX');
    equal(child.absY, 27, 'absY');
  });

  add('renderState is one of the RenderState values', async (renderer) => {
    const node = box(renderer, renderer.root, 0);
    await h.settle();
    const values: number[] = Object.values(RenderState);
    if (values.indexOf(node.renderState) === -1)
      fail('renderState ' + node.renderState + ' is not a RenderState value');
  });

  add('animate returns a controller that runs to its target', async (r) => {
    const node = box(r, r.root, 0);
    const controller = node.animate({ x: 50 }, { duration: 1 });
    for (const method of [
      'start',
      'stop',
      'pause',
      'restore',
      'waitUntilStopped',
    ] as const)
      if (typeof controller[method] !== 'function')
        fail('animation controller has no ' + method + '()');
    controller.start();
    await controller.waitUntilStopped();
    equal(node.x, 50, 'x after the animation');
    equal(controller.state, 'stopped', 'state after the animation');
  });

  add('animateProp starts at once and lands on its target', async (r) => {
    const node = box(r, r.root, 0);
    const controller = node.animateProp('alpha', 0.5, { duration: 1 });
    if (controller.state === 'stopped' && node.alpha !== 0.5)
      fail('animateProp returned a controller that was not started');
    await controller.waitUntilStopped();
    equal(node.alpha, 0.5, 'alpha after animateProp');
  });

  add('a text node reads back its text props', (renderer) => {
    const text: SceneTextNode = renderer.createTextNode({
      text: 'Hello',
      fontSize: 32,
      maxLines: 2,
      parent: renderer.root,
    });
    equal(text.text, 'Hello', 'text');
    equal(text.fontSize, 32, 'fontSize');
    equal(text.maxLines, 2, 'maxLines');
    text.text = 'World';
    equal(text.text, 'World', 'text after a write');
  });

  add('a rounded shader is created and attaches to a node', (renderer) => {
    const shader = renderer.createShader('rounded', { radius: 8 });
    if (shader === null) return; // the backend has no such effect
    if (!('shaderType' in shader)) fail('shader has no shaderType');
    const node = box(renderer, renderer.root, 0);
    node.shader = shader;
    if (node.shader === null) fail('node.shader is null after assignment');
  });

  add('listeners can be added and removed', (renderer) => {
    const node = box(renderer, renderer.root, 0);
    const listener = () => {};
    node.on('loaded', listener);
    node.once('failed', listener);
    node.off('loaded', listener);
    renderer.on('idle', listener);
  });

  if (h.scheduled) {
    const scheduled = h.scheduled;
    add('an idle scene schedules nothing', async (renderer) => {
      box(renderer, renderer.root, 0);
      await h.settle();
      await h.settle();
      const before = scheduled();
      await new Promise((resolve) => setTimeout(resolve, 150));
      // The wait above is this test's own timer.
      const added = scheduled() - before - 1;
      if (added > 0)
        fail(added + ' callbacks were scheduled while the scene was idle');
    });
  }

  return cases;
}
