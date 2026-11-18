// The scene contract's prop names on the Roku SceneGraph backend: a write must
// reach the node's own accessor (and through it SceneGraph), never become an
// expando property. `@roku-sdk/*` is replaced by tests/fakes/roku-sdk.mjs,
// which records the fields the backend writes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';

const sdk = new URL('./fakes/roku-sdk.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@roku-sdk/solid' || specifier === '@roku-sdk/rsg-ts/runtime') {
      return { url: sdk, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { createElement } = await import(sdk);
const { SceneGraphRenderer } = await import('../dist/roku/index.js');

function scene(t) {
  const renderer = new SceneGraphRenderer({}, createElement('group'));
  t.after(() => renderer.destroy());
  return renderer;
}

/** The SceneGraph fields written below `node`, as plain comparable data. */
function written(node) {
  const props = {};
  for (const [name, value] of Object.entries(node.props)) {
    // An Effect node is written as a reference: compare what it holds.
    props[name] = typeof value === 'function' ? '[function]' : value?.type === 'effect' ? value.props : value;
  }
  return { type: node.type, props, children: node.children.map(written) };
}

const isExpando = (node, name) => Object.hasOwn(node, name);

const TL = 0xff0000ff;
const TR = 0x00ff00ff;
const BL = 0x0000ffff;
const BR = 0xffff00ff;
const box = { x: 10, y: 20, w: 64, h: 32 };

test('colorTl/Tr/Bl/Br draw the same corners as the long names', (t) => {
  const renderer = scene(t);
  const parent = renderer.root;
  const shortProps = renderer.createNode({ ...box, parent, colorTl: TL, colorTr: TR, colorBl: BL, colorBr: BR });
  const longProps = renderer.createNode({
    ...box, parent, colorTopLeft: TL, colorTopRight: TR, colorBottomLeft: BL, colorBottomRight: BR,
  });
  const shortLive = renderer.createNode({ ...box, parent });
  Object.assign(shortLive, { colorTl: TL, colorTr: TR, colorBl: BL, colorBr: BR });
  const longLive = renderer.createNode({ ...box, parent });
  Object.assign(longLive, { colorTopLeft: TL, colorTopRight: TR, colorBottomLeft: BL, colorBottomRight: BR });
  const unset = renderer.createNode({ ...box, parent });
  renderer.flush();

  const expected = written(longProps.dom);
  // The corners reached SceneGraph: the top row is the rectangle's gradient,
  // and the bottom corners are weight images tinted with their colours.
  const [rect, bottomLeft, bottomRight] = longProps.dom.children;
  assert.equal(rect.type, 'rectangle');
  assert.deepEqual(rect.props.effect.props.gradientColors, ['0xFF0000FF', '0x00FF00FF']);
  assert.deepEqual(
    [bottomLeft.type, bottomLeft.props.uri, bottomLeft.props.blendColor],
    ['poster', 'pkg:/assets/smp/weight-bl.png', '0x0000FFFF'],
  );
  assert.deepEqual(
    [bottomRight.type, bottomRight.props.uri, bottomRight.props.blendColor],
    ['poster', 'pkg:/assets/smp/weight-br.png', '0xFFFF00FF'],
  );
  assert.deepEqual(written(unset.dom).children, []);

  for (const node of [shortProps, shortLive, longLive]) {
    assert.deepEqual(written(node.dom), expected);
  }
  for (const node of [shortProps, longProps, shortLive, longLive]) {
    assert.deepEqual([node.colorTl, node.colorTr, node.colorBl, node.colorBr], [TL, TR, BL, BR]);
    assert.deepEqual(
      [node.colorTopLeft, node.colorTopRight, node.colorBottomLeft, node.colorBottomRight],
      [TL, TR, BL, BR],
    );
    for (const name of ['colorTl', 'colorTr', 'colorBl', 'colorBr']) {
      assert.equal(isExpando(node, name), false);
    }
  }
});

test('a corner that was not set reads the colour it draws with', (t) => {
  const renderer = scene(t);
  const flat = renderer.createNode({ ...box, color: 0x112233ff });
  assert.deepEqual([flat.colorTl, flat.colorTr, flat.colorBl, flat.colorBr], Array(4).fill(0x112233ff));
  assert.deepEqual([flat.colorTop, flat.colorBottom, flat.colorLeft, flat.colorRight], Array(4).fill(0x112233ff));

  const sides = renderer.createNode({ ...box, colorTop: TL, colorBottom: BL });
  assert.deepEqual([sides.colorTl, sides.colorTr, sides.colorBl, sides.colorBr], [TL, TL, BL, BL]);
  // An explicit corner wins over its side, whichever was written first.
  sides.colorTr = TR;
  assert.deepEqual([sides.colorTl, sides.colorTr, sides.colorTop], [TL, TR, TL]);
});

test('animateProp drives a corner colour through its accessor', async (t) => {
  const renderer = scene(t);
  const node = renderer.createNode({ ...box, parent: renderer.root, colorTl: TL });
  const controller = node.animateProp('colorTl', BR, { duration: 0 });
  assert.equal(controller.state, 'running');
  await controller.waitUntilStopped();
  assert.equal(controller.state, 'stopped');
  assert.equal(node.colorTl, BR);
  assert.equal(isExpando(node, 'colorTl'), false);
});

test('mount and pivot set both axes and read the X axis', (t) => {
  const renderer = scene(t);
  const node = renderer.createNode({ x: 100, y: 200, w: 40, h: 20, color: 0xffffffff, parent: renderer.root });
  assert.equal(node.mount, 0);
  assert.equal(node.pivot, 0.5);

  node.mount = 0.5;
  assert.deepEqual([node.mount, node.mountX, node.mountY], [0.5, 0.5, 0.5]);
  renderer.flush();
  assert.deepEqual(node.dom.props.translation, [80, 190]);
  assert.deepEqual([node.absX, node.absY], [80, 190]);

  node.mountY = 1;
  assert.equal(node.mount, 0.5);
  renderer.flush();
  assert.deepEqual(node.dom.props.translation, [80, 180]);

  node.pivot = 0.25;
  assert.deepEqual([node.pivot, node.pivotX, node.pivotY], [0.25, 0.25, 0.25]);
  renderer.flush();
  assert.deepEqual(node.dom.props.scaleRotateCenter, [10, 5]);
  node.pivotY = 1;
  assert.equal(node.pivot, 0.25);

  const created = renderer.createNode({ x: 0, y: 0, w: 40, h: 20, color: 0xffffffff, mount: 1, pivot: 0 });
  assert.deepEqual([created.mountX, created.mountY, created.pivotX, created.pivotY], [1, 1, 0, 0]);
  renderer.flush();
  assert.deepEqual(created.dom.props.translation, [-40, -20]);
  assert.deepEqual(created.dom.props.scaleRotateCenter, [0, 0]);
  for (const name of ['mount', 'pivot']) {
    assert.equal(isExpando(node, name), false);
    assert.equal(isExpando(created, name), false);
  }
});

test('srcX/srcY/srcWidth/srcHeight crop a sprite sheet as a SubTexture does', (t) => {
  const renderer = scene(t);
  const parent = renderer.root;
  const sheet = 'pkg:/assets/sheet.png';
  // SceneGraph reports a bitmap's size once it has loaded; the crop needs it.
  const load = (node, width = 375, height = 100) => {
    const poster = node.dom.children[0];
    poster.props.onBitmapWidth(width);
    poster.props.onBitmapHeight(height);
    poster.props.onLoadStatus('ready');
    renderer.flush();
    return poster;
  };
  const rect = renderer.createNode({ w: 50, h: 50, parent, src: sheet, srcX: 50, srcY: 10, srcWidth: 50, srcHeight: 50 });
  const texture = renderer.createTexture('SubTexture', {
    texture: renderer.createTexture('ImageTexture', { src: sheet }),
    x: 50, y: 10, w: 50, h: 50,
  });
  const sub = renderer.createNode({ w: 50, h: 50, parent, texture });
  renderer.flush();
  // Hidden until its size is known, so the whole sheet never flashes.
  assert.equal(rect.dom.children[0].props.opacity, 0);
  const poster = load(rect);
  load(sub);
  assert.deepEqual(written(rect.dom), written(sub.dom));
  assert.equal(poster.type, 'poster');
  assert.deepEqual(
    [poster.props.width, poster.props.height, poster.props.opacity, poster.props.translation],
    [375, 100, 1, [-50, -10]],
  );
  assert.deepEqual(rect.dom.props.clippingRect, [0, 0, 50, 50]);

  // A region drawn larger than it is scales the sheet with it.
  const scaled = renderer.createNode({ w: 100, h: 100, parent, src: sheet, srcX: 50, srcY: 10, srcWidth: 50, srcHeight: 50 });
  renderer.flush();
  const big = load(scaled);
  assert.deepEqual([big.props.width, big.props.height, big.props.translation], [750, 200, [-100, -20]]);

  // Written after creation; as on the web a crop needs a width and a height.
  const live = renderer.createNode({ w: 50, h: 50, parent, src: sheet });
  assert.deepEqual([live.srcX, live.srcY, live.srcWidth, live.srcHeight], Array(4).fill(undefined));
  live.srcX = 100;
  live.srcWidth = 50;
  renderer.flush();
  const image = load(live);
  assert.deepEqual([image.props.width, image.props.loadDisplayMode], [50, 'scaleToFill']);
  live.srcHeight = 50;
  renderer.flush();
  assert.deepEqual(
    [image.props.width, image.props.height, image.props.translation.map((v) => v + 0)],
    [375, 100, [-100, 0]], // `+ 0`: an unset srcY is written as -0
  );
  assert.deepEqual(live.dom.props.clippingRect, [0, 0, 50, 50]);
  assert.deepEqual([live.srcX, live.srcY, live.srcWidth, live.srcHeight], [100, undefined, 50, 50]);

  live.srcWidth = undefined;
  renderer.flush();
  assert.deepEqual(
    [image.props.width, image.props.loadDisplayMode, image.props.translation],
    [50, 'scaleToFill', [0, 0]],
  );
  assert.deepEqual(live.dom.props.clippingRect, [0, 0, 100000, 100000]);
  assert.equal(isExpando(live, 'srcX'), false);
});

test('autosize, ignoreParentAlpha, imageType and fontStyle are stored and read back', (t) => {
  const renderer = scene(t);
  const parent = renderer.root;
  const node = renderer.createNode({ ...box, parent, color: 0x000000ff });
  const text = renderer.createTextNode({ parent, text: 'a' });
  assert.deepEqual([node.autosize, node.ignoreParentAlpha, node.imageType, text.fontStyle], [false, false, null, 'normal']);
  renderer.flush();
  const before = [written(node.dom), written(text.dom)];

  node.autosize = true;
  node.ignoreParentAlpha = true;
  node.imageType = 'svg';
  text.fontStyle = 'italic';
  assert.deepEqual([node.autosize, node.ignoreParentAlpha, node.imageType, text.fontStyle], [true, true, 'svg', 'italic']);
  for (const name of ['autosize', 'ignoreParentAlpha', 'imageType']) {
    assert.equal(isExpando(node, name), false);
  }
  assert.equal(isExpando(text, 'fontStyle'), false);
  // Stored only: none of them writes a SceneGraph field.
  renderer.flush();
  assert.deepEqual([written(node.dom), written(text.dom)], before);

  // Solid assigns `undefined` to undo a state style.
  node.autosize = undefined;
  node.ignoreParentAlpha = undefined;
  node.imageType = undefined;
  text.fontStyle = undefined;
  assert.deepEqual([node.autosize, node.ignoreParentAlpha, node.imageType, text.fontStyle], [false, false, null, 'normal']);

  const created = renderer.createNode({ autosize: true, ignoreParentAlpha: true, imageType: 'compressed' });
  assert.deepEqual([created.autosize, created.ignoreParentAlpha, created.imageType], [true, true, 'compressed']);
  assert.equal(renderer.createTextNode({ text: 'a', fontStyle: 'oblique' }).fontStyle, 'oblique');
});

test('listeners get (target, data), and off without a listener removes them all', (t) => {
  const renderer = scene(t);
  const parent = renderer.root;
  const node = renderer.createNode({ w: 64, h: 32, parent, src: 'pkg:/assets/a.png' });
  const broken = renderer.createNode({ w: 64, h: 32, parent, src: 'pkg:/assets/b.png' });
  const seen = [];
  node.on('loaded', (...args) => seen.push(args));
  broken.once('failed', (...args) => seen.push(args));
  renderer.flush();
  const poster = node.dom.children[0];
  poster.props.onBitmapWidth(128);
  poster.props.onBitmapHeight(64);
  poster.props.onLoadStatus('loaded');
  broken.dom.children[0].props.onLoadStatus('failed');
  assert.equal(seen.length, 2);
  assert.equal(seen[0].length, 2);
  assert.equal(seen[0][0], node);
  assert.deepEqual(seen[0][1], { type: 'image', dimensions: { width: 128, height: 64 } });
  assert.equal(seen[1][0], broken);
  assert.deepEqual(seen[1][1], { type: 'image' });

  let calls = 0;
  const first = () => calls++;
  const second = () => calls++;
  node.on('custom', first);
  node.on('custom', second);
  node.off('custom', first);
  node.emit('custom');
  assert.equal(calls, 1);
  node.on('custom', first);
  node.off('custom');
  node.emit('custom');
  assert.equal(calls, 1);
});

test('the renderer and node methods the contract names', async (t) => {
  const renderer = scene(t);
  assert.equal(renderer.stage, renderer);
  assert.equal(renderer.createShader('rounded', { radius: 8 }).shaderType, 'rounded');
  assert.equal(renderer.createTexture('ImageTexture', { src: 'pkg:/assets/a.png' }).src, 'pkg:/assets/a.png');
  // A font needs its file: without one the load is refused, not ignored.
  await assert.rejects(renderer.loadFont({ fontFamily: 'Roboto' }), /fontUrl/);
  renderer.requestRender();

  const parent = renderer.createNode({ ...box, parent: renderer.root });
  const a = renderer.createNode(box);
  const b = renderer.createNode(box);
  const c = renderer.createNode(box);
  parent.insertBefore(a, null);
  parent.insertBefore(b, null);
  parent.insertBefore(c, a);
  assert.deepEqual(parent.children, [c, a, b]);
  parent.insertBefore(c, null);
  assert.deepEqual(parent.children, [a, b, c]);
  assert.deepEqual(parent.dom.children, [a.dom, b.dom, c.dom]);
  assert.equal(c.parent, parent);

  const controller = a.animate({ x: 50, mount: 1 }, { duration: 0 });
  assert.equal(controller.state, 'scheduled');
  controller.start();
  await controller.waitUntilStopped();
  assert.deepEqual([a.x, a.mountX, a.mountY], [50, 1, 1]);

  a.destroy();
  assert.deepEqual(parent.children, [b, c]);
});
