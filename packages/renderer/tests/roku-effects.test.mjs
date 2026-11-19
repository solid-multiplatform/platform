// How the Roku SceneGraph backend draws rounded corners, borders, gradients,
// corner colours and shadows on each tier, and how it shares Effect nodes.
// `@roku-sdk/*` is replaced by tests/fakes/roku-sdk.mjs, which records the
// fields the backend writes and counts the nodes it creates.
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
const { createElement, created, device } = await import(sdk);
const { SceneGraphRenderer, detectEffectTier } = await import('../dist/roku/index.js');
const { planDecor, nativeAngle, effectGaps } = await import('../dist/roku/effects.js');

const RED = 0xff0000ff;
const GREEN = 0x00ff00ff;
const BLUE = 0x0000ffff;
const YELLOW = 0xffff00ff;

/** A plan for a 200x100 rectangle node of one colour with this shader. */
function plan(name, props, more = {}) {
  return planDecor({
    tier: 'native', w: 200, h: 100,
    tl: RED, tr: RED, bl: RED, br: RED,
    image: false, blend: 0xffffffff,
    shader: name ? { name, props } : null,
    ...more,
  });
}

function scene(t, settings = {}) {
  const renderer = new SceneGraphRenderer(settings, createElement('group'));
  t.after(() => renderer.destroy());
  return renderer;
}

// ---- tier selection ---------------------------------------------------------

test('the tier is native only on Roku OS 16+ with the OpenGL graphics platform', (t) => {
  const info = device.info;
  t.after(() => { device.info = info; });
  assert.equal(detectEffectTier(), 'native');
  device.info = { osVersion: { major: '15' }, graphicsPlatform: 'opengl' };
  assert.equal(detectEffectTier(), 'assets');
  device.info = { osVersion: { major: '16' }, graphicsPlatform: 'directfb' };
  assert.equal(detectEffectTier(), 'assets');
  device.info = { osVersion: { major: '17' }, graphicsPlatform: 'opengl' };
  assert.equal(detectEffectTier(), 'native');
  // A device that reports nothing is not assumed to draw effects.
  device.info = null;
  assert.equal(detectEffectTier(), 'assets');

  device.info = { osVersion: { major: '16' }, graphicsPlatform: 'directfb' };
  const renderer = scene(t);
  assert.equal(renderer.effectTier, 'assets');
  assert.equal(renderer.getCapabilities().effects, 'assets');
  // Chosen once: what the device reports later changes nothing.
  device.info = info;
  assert.equal(renderer.effectTier, 'assets');
  assert.equal(scene(t, { effectTier: 'assets' }).effectTier, 'assets');
});

// ---- native tier: the Effect node's fields ----------------------------------

test('a radius maps to borderRadius, per corner and clamped to the box', () => {
  assert.equal(plan('rounded', { radius: 12 }).effect.borderRadius, 12);
  // [top-left, top-right, bottom-right, bottom-left], the Effect node's order.
  assert.deepEqual(plan('rounded', { radius: [0, 10, 20, 30] }).effect.borderRadius, [0, 10, 20, 30]);
  // The Effect node draws a lens for a radius past half the box: clamp it.
  assert.equal(plan('rounded', { radius: 500 }).effect.borderRadius, 50);
  assert.equal(plan('rounded', { radius: 0 }).effect, null);
  assert.equal(plan(null).effect, null);
});

test('a uniform border is the Effect border: outside by default, inset when inside', () => {
  const outside = plan('roundedWithBorder', { radius: 20, 'border-w': 8, 'border-color': YELLOW });
  assert.deepEqual(
    [outside.effect.borderWidth, outside.effect.borderColor, outside.effect.borderRadius, outside.effect.borderPadding],
    [8, '0xFFFF00FF', 20, 0],
  );
  assert.deepEqual([outside.x, outside.y, outside.w, outside.h], [0, 0, 200, 100]);

  // The Effect border is always outside its rectangle: an inside border
  // shrinks the rectangle by the width, and the corner with it.
  const inside = plan('roundedWithBorder', { radius: 20, 'border-w': 8, 'border-align': 'inside' });
  assert.deepEqual([inside.x, inside.y, inside.w, inside.h], [8, 8, 184, 84]);
  assert.deepEqual([inside.effect.borderWidth, inside.effect.borderRadius], [8, 12]);

  const gap = plan('roundedWithBorder', { 'border-w': 4, 'border-gap': 6 });
  assert.deepEqual([gap.effect.borderWidth, gap.effect.borderPadding], [4, 6]);
  assert.equal(plan('roundedWithBorder', { 'border-w': 0 }).effect, null);
});

test('per-side border widths are rectangles, as a border under the node is', () => {
  // What `borderBottom={{ width: 6 }}` sends: the object rides along unread.
  const under = plan('roundedWithBorder', { border: { width: 6 }, 'border-bottom': 6, 'border-color': YELLOW });
  assert.equal(under.effect, null);
  assert.deepEqual(under.layers, [
    { uri: null, color: '0xFFFF00FF', x: 0, y: 100, w: 200, h: 6, rounded: false },
  ]);
  const sides = plan('roundedWithBorder', { 'border-w': [2, 4, 6, 8], 'border-align': 'inside' });
  assert.deepEqual(sides.layers.map((l) => [l.x, l.y, l.w, l.h]), [
    [0, 0, 200, 2], // top
    [0, 94, 200, 6], // bottom
    [0, 2, 8, 92], // left
    [196, 2, 4, 92], // right
  ]);
  // With a radius the Effect border is used: one width, and that is reported.
  const rounded = plan('roundedWithBorder', { radius: 10, 'border-w': [2, 4, 6, 8] });
  assert.equal(rounded.effect.borderWidth, 8);
  assert.ok(effectGaps().some((gap) => /per-side border widths/.test(gap)));
});

test('a linear gradient maps its angle, colours and stops', () => {
  // The platform: 0 is top to bottom, PI/2 right to left. The Effect node:
  // degrees, 0 up and 90 right.
  assert.equal(nativeAngle(0, 100, 100), 180);
  assert.equal(nativeAngle(Math.PI / 2, 100, 100), 270);
  assert.equal(nativeAngle(Math.PI, 100, 100), 0);
  assert.equal(nativeAngle(Math.PI / 4, 100, 100), 225);
  // The Effect node measures the angle in the node's unit square; the
  // platform means pixels. On a 2:1 box 45 degrees needs atan2(-2, -1).
  assert.equal(nativeAngle(Math.PI / 4, 200, 100), 243.43);

  const g = plan('linearGradient', { angle: 0, colors: [RED, GREEN, BLUE], stops: [0, 0.25, 1] }).effect;
  assert.deepEqual(
    [g.gradientStyle, g.gradientAngle, g.gradientColors, g.gradientStops],
    ['linear', 180, ['0xFF0000FF', '0x00FF00FF', '0x0000FFFF'], [0, 0.25, 1]],
  );
  // Stops that do not match the colours spread evenly: one stop per colour, always.
  assert.deepEqual(plan('linearGradient', { colors: [RED, GREEN, BLUE], stops: [0, 1] }).effect.gradientStops, [0, 0.5, 1]);
  assert.deepEqual(plan('linearGradient', { colors: [RED, BLUE] }).effect.gradientStops, [0, 1]);
  // The gradient goes over the node's colour, as on WebGL: the rectangle keeps it.
  assert.equal(plan('linearGradient', { colors: [RED, BLUE] }, { tl: GREEN, tr: GREEN, bl: GREEN, br: GREEN }).color, '0x00FF00FF');
});

test('a gradient never carries more than 8 colours or fewer than 2', () => {
  const nine = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (n << 24) | 0xff);
  const g = plan('linearGradient', { colors: nine }).effect;
  assert.equal(g.gradientColors.length, 8);
  assert.equal(g.gradientStops.length, 8);
  // The ends are kept.
  assert.deepEqual([g.gradientColors[0], g.gradientColors[7]], ['0x010000FF', '0x090000FF']);
  assert.deepEqual([g.gradientStops[0], g.gradientStops[7]], [0, 1]);
  assert.ok(effectGaps().some((gap) => /more than 8 colours/.test(gap)));
  assert.equal(plan('linearGradient', { colors: [RED] }).effect, null);
});

test('a radial gradient maps its centre and its radii as fractions of the node', () => {
  const g = plan('radialGradient', { colors: [RED, BLUE], w: 50, h: 25, pivot: [0.25, 0.75] }).effect;
  assert.deepEqual(
    [g.gradientStyle, g.gradientCentre, g.gradientRadius],
    ['radial', [0.25, 0.75], [0.25, 0.25]],
  );
});

test('side colours are one Effect gradient over a transparent rectangle', () => {
  const vertical = plan(null, null, { tl: RED, tr: RED, bl: BLUE, br: BLUE });
  assert.deepEqual(
    [vertical.color, vertical.effect.gradientAngle, vertical.effect.gradientColors, vertical.layers],
    ['0x00000000', 180, ['0xFF0000FF', '0x0000FFFF'], []],
  );
  const horizontal = plan(null, null, { tl: RED, tr: BLUE, bl: RED, br: BLUE });
  assert.deepEqual([horizontal.effect.gradientAngle, horizontal.effect.gradientColors], [90, ['0xFF0000FF', '0x0000FFFF']]);
  // With a radius the same Effect rounds the gradient.
  assert.equal(plan('rounded', { radius: 10 }, { tl: RED, tr: RED, bl: BLUE, br: BLUE }).effect.borderRadius, 10);
});

test('four corner colours are the top row and two weighted layers', () => {
  const p = plan('rounded', { radius: 10 }, { tl: RED, tr: GREEN, bl: BLUE, br: YELLOW });
  assert.deepEqual(p.effect.gradientColors, ['0xFF0000FF', '0x00FF00FF']);
  assert.deepEqual(p.layers, [
    { uri: 'pkg:/assets/smp/weight-bl.png', color: '0x0000FFFF', x: 0, y: 0, w: 200, h: 100, rounded: true },
    { uri: 'pkg:/assets/smp/weight-br.png', color: '0xFFFF00FF', x: 0, y: 0, w: 200, h: 100, rounded: true },
  ]);
  // The layers take the radius without the gradient.
  assert.deepEqual([p.layerEffect.borderRadius, p.layerEffect.gradientStyle], [10, 'none']);
});

test('a shadow is a tinted 9-patch behind the node, sized by offset, spread and blur', () => {
  const p = plan('roundedWithShadow', { radius: 16, 'shadow-color': 0x00000080, 'shadow-x': 4, 'shadow-y': 24, 'shadow-blur': 16, 'shadow-spread': 2 });
  // The image fades from 16 inside the shadow box to 16 outside it.
  assert.deepEqual(p.shadow, {
    uri: 'pkg:/assets/smp/shadow-r16-b16.9.png', color: '0x00000080',
    x: 4 - 18, y: 24 - 18, w: 200 + 36, h: 100 + 36, rounded: false,
  });
  // The WebGL defaults: no offset, blur 5, spread 5.
  const implied = plan('roundedWithShadow', {}).shadow;
  assert.deepEqual([implied.uri, implied.x, implied.w], ['pkg:/assets/smp/shadow-r0-b4.9.png', -9, 218]);
  assert.equal(plan('rounded', { radius: 4 }).shadow, null);
  assert.equal(plan('roundedWithShadow', { 'shadow-color': 0x00000000 }).shadow, null);
});

test('an image takes the Effect for its corners and border, and one tint', () => {
  const p = plan('roundedWithBorder', { radius: 12, 'border-w': 2 }, { image: true, blend: 0xffffff80 });
  assert.deepEqual([p.color, p.effect.borderRadius, p.effect.borderWidth], ['0xFFFFFF80', 12, 2]);
});

// ---- assets tier ------------------------------------------------------------

test('without the Effect node corners are square, and that is reported', () => {
  const p = plan('rounded', { radius: 12 }, { tier: 'assets' });
  assert.deepEqual([p.effect, p.layerEffect, p.color, p.layers], [null, null, '0xFF0000FF', []]);
  assert.ok(effectGaps().some((gap) => /rounded corners need the Effect node/.test(gap)));
});

test('without the Effect node gradients are tinted ramps', () => {
  const assets = { tier: 'assets' };
  const vertical = plan(null, null, { ...assets, tl: RED, tr: RED, bl: BLUE, br: BLUE });
  assert.deepEqual([vertical.color, vertical.effect], ['0xFF0000FF', null]);
  assert.deepEqual(vertical.layers, [
    { uri: 'pkg:/assets/smp/ramp-v.png', color: '0x0000FFFF', x: 0, y: 0, w: 200, h: 100, rounded: false },
  ]);
  const corners = plan(null, null, { ...assets, tl: RED, tr: GREEN, bl: BLUE, br: YELLOW });
  assert.deepEqual(corners.layers.map((l) => [l.uri.replace('pkg:/assets/smp/', ''), l.color]), [
    ['ramp-h.png', '0x00FF00FF'],
    ['weight-bl.png', '0x0000FFFF'],
    ['weight-br.png', '0xFFFF00FF'],
  ]);

  // Right to left (PI/2): the colours run from the right, so they are drawn reversed.
  const linear = plan('linearGradient', { angle: Math.PI / 2, colors: [RED, BLUE] }, assets);
  assert.equal(linear.color, '0x0000FFFF');
  assert.deepEqual(linear.layers, [
    { uri: 'pkg:/assets/smp/ramp-h.png', color: '0xFF0000FF', x: 0, y: 0, w: 200, h: 100, rounded: false },
  ]);
  // Stops: a ramp per span, then the colour held to the end.
  const stops = plan('linearGradient', { angle: 0, colors: [RED, GREEN, BLUE], stops: [0, 0.25, 1] }, assets);
  assert.equal(stops.color, '0xFF0000FF');
  assert.deepEqual(stops.layers.map((l) => [l.uri ? 'ramp' : 'fill', l.color, l.y, l.h]), [
    ['ramp', '0x00FF00FF', 0, 25],
    ['fill', '0x00FF00FF', 25, 75],
    ['ramp', '0x0000FFFF', 25, 75],
  ]);
  // A slanted gradient has no ramp: the nearer axis, reported.
  plan('linearGradient', { angle: Math.PI / 3, colors: [RED, BLUE] }, assets);
  assert.ok(effectGaps().some((gap) => /angle snaps to an axis/.test(gap)));

  const radial = plan('radialGradient', { colors: [RED, BLUE], w: 40, h: 30 }, assets);
  assert.equal(radial.color, '0x0000FFFF');
  assert.deepEqual(radial.layers, [
    { uri: 'pkg:/assets/smp/ramp-radial.png', color: '0xFF0000FF', x: 60, y: 20, w: 80, h: 60, rounded: false },
  ]);
});

test('without the Effect node a border is four rectangles', () => {
  const p = plan('roundedWithBorder', { 'border-w': 4, 'border-color': YELLOW }, { tier: 'assets' });
  assert.equal(p.effect, null);
  assert.deepEqual(p.layers.map((l) => [l.x, l.y, l.w, l.h]), [
    [-4, -4, 208, 4],
    [-4, 100, 208, 4],
    [-4, 0, 4, 100],
    [200, 0, 4, 100],
  ]);
});

// ---- nodes: what reaches SceneGraph -----------------------------------------

const box = { x: 0, y: 0, w: 200, h: 100 };

test('effects given as flat props (shaders compiled out) draw as a shader does', (t) => {
  const renderer = scene(t);
  const parent = renderer.root;
  // What the platform passes at creation when SOLIDTV_DISABLE_SHADERS is set.
  const flat = { radius: 12, border: { width: 4, color: YELLOW }, 'border-w': 4, 'border-color': YELLOW };
  const raw = renderer.createNode({ ...box, parent, color: RED, shader: flat });
  const made = renderer.createNode({ ...box, parent, color: RED, shader: renderer.createShader('roundedWithBorder', { ...flat }) });
  renderer.flush();
  const effect = raw.dom.children[0].props.effect;
  assert.equal(effect.type, 'effect');
  assert.deepEqual(
    [effect.props.borderRadius, effect.props.borderWidth, effect.props.borderColor],
    [12, 4, '0xFFFF00FF'],
  );
  assert.equal(made.dom.children[0].props.effect, effect);
  // The node now holds a shader whose props the platform keeps writing.
  raw.shader.props.radius = 20;
  renderer.flush();
  assert.equal(raw.dom.children[0].props.effect.props.borderRadius, 20);
});

test('the Effect node is never a child: the visual refers to it', (t) => {
  const renderer = scene(t);
  const node = renderer.createNode({ ...box, parent: renderer.root, color: RED, shader: renderer.createShader('rounded', { radius: 8 }) });
  renderer.flush();
  const rect = node.dom.children[0];
  assert.equal(rect.props.effect.type, 'effect');
  assert.equal(rect.props.effect.parent, null);
  assert.deepEqual(rect.children, []);
});

test('nodes with equal effect values share one Effect node', (t) => {
  const renderer = scene(t);
  const parent = renderer.root;
  const before = created.effect || 0;
  const nodes = [0, 1, 2].map(() =>
    renderer.createNode({ ...box, parent, color: RED, shader: renderer.createShader('rounded', { radius: 8 }) }),
  );
  const other = renderer.createNode({ ...box, parent, color: RED, shader: renderer.createShader('rounded', { radius: 9 }) });
  renderer.flush();
  const effects = nodes.map((node) => node.dom.children[0].props.effect);
  assert.equal(effects[0], effects[1]);
  assert.equal(effects[0], effects[2]);
  assert.notEqual(other.dom.children[0].props.effect, effects[0]);
  assert.equal((created.effect || 0) - before, 2);
  assert.equal(renderer.effects.created, 2);

  // A node that changes while others share its Effect leaves them theirs.
  nodes[0].shader.props.radius = 9;
  renderer.flush();
  assert.equal(nodes[0].dom.children[0].props.effect, other.dom.children[0].props.effect);
  assert.equal(nodes[1].dom.children[0].props.effect, effects[0]);
  assert.equal(effects[0].props.borderRadius, 8);
  assert.equal(renderer.effects.created, 2);

  // The Effect outlives a node that used it, for the others.
  nodes[1].destroy();
  renderer.flush();
  assert.equal(nodes[2].dom.children[0].props.effect.props.borderRadius, 8);
});

test('an image writes shaderCompatible before its uri', (t) => {
  const renderer = scene(t);
  const node = renderer.createNode({ ...box, parent: renderer.root, src: 'pkg:/assets/a.png', shader: renderer.createShader('rounded', { radius: 8 }) });
  renderer.flush();
  const poster = node.dom.children[0];
  const written = Object.keys(poster.props);
  assert.equal(poster.props.shaderCompatible, true);
  assert.equal(poster.props.effect.props.borderRadius, 8);
  assert.ok(written.indexOf('shaderCompatible') < written.indexOf('uri'));
  assert.ok(written.indexOf('effect') < written.indexOf('uri'));
});

test('the shadow, the visual and the layers paint below the children, in that order', (t) => {
  const renderer = scene(t);
  const node = renderer.createNode({
    ...box, parent: renderer.root, colorTl: RED, colorTr: GREEN, colorBl: BLUE, colorBr: YELLOW,
    shader: renderer.createShader('roundedWithShadow', { radius: 16, 'shadow-color': 0x000000ff, 'shadow-blur': 16 }),
  });
  const child = renderer.createNode({ w: 10, h: 10, color: RED, parent: node });
  renderer.flush();
  assert.deepEqual(
    node.dom.children.map((n) => n.props.uri?.replace('pkg:/assets/smp/', '') ?? n.type),
    ['shadow-r16-b16.9.png', 'rectangle', 'weight-bl.png', 'weight-br.png', 'group'],
  );
  assert.equal(node.dom.children[4], child.dom);
  // The rounded layers share one Effect, and it is not the rectangle's.
  const [, rect, bl, br] = node.dom.children;
  assert.equal(bl.props.effect, br.props.effect);
  assert.notEqual(bl.props.effect, rect.props.effect);

  // A zIndex sort keeps the node's own drawing first.
  const top = renderer.createNode({ w: 10, h: 10, color: RED, parent: node, zIndex: -1 });
  renderer.flush();
  assert.deepEqual(node.dom.children.slice(4), [top.dom, child.dom]);
  assert.equal(node.dom.children[1].type, 'rectangle');

  // Dropping the shadow and the corner colours removes their nodes.
  node.shader = null;
  node.colorTr = RED;
  node.colorBl = RED;
  node.colorBr = RED;
  renderer.flush();
  assert.deepEqual(node.dom.children.map((n) => n.type), ['rectangle', 'group', 'group']);
  assert.equal(node.dom.children[0].props.effect, null);
});

// ---- animation --------------------------------------------------------------

/** Every node the fake SDK has created, of any type. */
const total = () => Object.values(created).reduce((sum, n) => sum + n, 0);

test('animating shader props changes the Effect in place and creates nothing', async (t) => {
  const renderer = scene(t);
  const style = { radius: 8, 'border-w': 2, 'border-color': RED };
  const node = renderer.createNode({
    ...box, parent: renderer.root, color: RED,
    shader: renderer.createShader('roundedWithBorder', style),
  });
  renderer.flush();
  const effect = node.dom.children[0].props.effect;
  const nodes = total();

  // What the platform's `borderRadius` transition does: it writes the end
  // values to the object it made the shader from, then animates to them.
  const target = { radius: 24, 'border-w': 6, 'border-color': BLUE };
  Object.assign(style, target);
  const controller = node.animate({ shaderProps: target }, { duration: 200 }).start();
  await new Promise((resolve) => setTimeout(resolve, 80));
  // Under way: between the values it had and the ones it is going to.
  const midway = effect.props.borderRadius;
  assert.ok(midway > 8 && midway < 24, 'radius midway is ' + midway);
  await controller.waitUntilStopped();
  renderer.flush();
  assert.equal(node.dom.children[0].props.effect, effect);
  assert.deepEqual(
    [effect.props.borderRadius, effect.props.borderWidth, effect.props.borderColor],
    [24, 6, '0x0000FFFF'],
  );
  assert.deepEqual([node.shader.props.radius, node.shader.props['border-w']], [24, 6]);
  // No node of any kind, and no Effect, was created while it ran.
  assert.equal(total(), nodes);
  assert.equal(renderer.effects.created, 1);
});

test('a node that animates away from a shared Effect takes one spare, once', async (t) => {
  const renderer = scene(t);
  const parent = renderer.root;
  const make = () => renderer.createNode({ ...box, parent, color: RED, shader: renderer.createShader('rounded', { radius: 8 }) });
  const [a, b] = [make(), make()];
  renderer.flush();
  const shared = b.dom.children[0].props.effect;
  assert.equal(a.dom.children[0].props.effect, shared);
  assert.equal(renderer.effects.created, 1);

  const run = async (radius) => {
    const controller = a.animate({ shaderProps: { radius } }, { duration: 60 }).start();
    await controller.waitUntilStopped();
    renderer.flush();
  };
  // Focus: `a` needs an Effect of its own, the one node this ever creates.
  await run(24);
  assert.equal(renderer.effects.created, 2);
  assert.equal(shared.props.borderRadius, 8);
  assert.equal(a.dom.children[0].props.effect.props.borderRadius, 24);
  // Blur: back on the shared one. Focus again: the spare is reused.
  await run(8);
  assert.equal(a.dom.children[0].props.effect, shared);
  await run(24);
  assert.equal(renderer.effects.created, 2);
  assert.equal(renderer.effects.size, 2);
});

test('animating a side colour rewrites the gradient, not the nodes', async (t) => {
  const renderer = scene(t);
  const node = renderer.createNode({ ...box, parent: renderer.root, colorTop: RED, colorBottom: BLUE });
  renderer.flush();
  const effect = node.dom.children[0].props.effect;
  const nodes = total();
  await node.animateProp('colorBottom', GREEN, { duration: 60 }).waitUntilStopped();
  renderer.flush();
  assert.equal(node.dom.children[0].props.effect, effect);
  assert.deepEqual(effect.props.gradientColors, ['0xFF0000FF', '0x00FF00FF']);
  assert.equal(total(), nodes);
});

// ---- images this backend cannot decode --------------------------------------

test('an image format a Poster cannot decode fails; nothing stands in for it', async (t) => {
  const renderer = scene(t);
  const node = renderer.createNode({ ...box, parent: renderer.root, src: 'pkg:/assets/image-1.ktx' });
  const failed = new Promise((resolve) => node.once('failed', (target, data) => resolve([target, data])));
  renderer.flush();
  // No Poster is made for it, and no other file is asked for.
  assert.deepEqual(node.dom.children, []);
  const [target, data] = await failed;
  assert.equal(target, node);
  assert.equal(data.type, 'image');
  assert.match(data.error.message, /image-1\.ktx/);
  assert.equal(node.src, 'pkg:/assets/image-1.ktx');
  assert.ok(effectGaps().some((gap) => /cannot decode ktx/.test(gap)));
});
