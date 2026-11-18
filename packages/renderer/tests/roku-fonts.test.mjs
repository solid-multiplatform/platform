// The font registry of the Roku SceneGraph backend (roku/fonts.ts) and
// renderer.loadFont: which font a text node gets, the one warning for a
// family nobody registered, and that waiting on the device is bounded and
// leaves no timer or poll behind. `@roku-sdk/*` is tests/fakes/roku-sdk.mjs,
// whose fonts load after a delay or never, as on a device.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sdk = new URL('./fakes/roku-sdk.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@roku-sdk/solid' || specifier === '@roku-sdk/rsg-ts/runtime') {
      return { url: sdk, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { createElement, created, fonts } = await import(sdk);
const { SceneGraphRenderer, FontRegistry, FontMetrics, registerFontMetrics } = await import('../dist/roku/index.js');
const { fontMetricsBase64 } = await import('../dist/roku/font-file.js');

// The tables the Roku preset would have made for these imported files.
const packed = (file) => fontMetricsBase64(new Uint8Array(readFileSync(fileURLToPath(new URL('../../platform/tests/roku-device/fonts/' + file, import.meta.url)))));
const REGULAR = 'pkg:/fonts/Roboto-Regular.ttf';
const BOLD = 'pkg:/fonts/Roboto-Bold.ttf';
const RALEWAY = 'pkg:/fonts/Raleway-ExtraBold.ttf';
const TABLES = { [REGULAR]: packed('Roboto-Regular.ttf'), [BOLD]: packed('Roboto-Bold.ttf'), [RALEWAY]: packed('Raleway-ExtraBold.ttf') };
for (const [uri, table] of Object.entries(TABLES)) registerFontMetrics(uri, table);
const roboto = FontMetrics.decode(TABLES[REGULAR]);

// Every timer that is armed and has neither fired nor been cleared.
const live = new Set();
const armTimeout = globalThis.setTimeout;
const disarmTimeout = globalThis.clearTimeout;
globalThis.setTimeout = (handler, ms, ...rest) => {
  const id = armTimeout(() => {
    live.delete(id);
    handler(...rest);
  }, ms);
  live.add(id);
  return id;
};
globalThis.clearTimeout = (id) => {
  live.delete(id);
  disarmTimeout(id);
};
const wait = (ms) => new Promise((resolve) => armTimeout(resolve, ms));

/** Runs with console.warn and console.error collected instead of printed. */
function quiet(t) {
  const said = [];
  for (const level of ['warn', 'error']) {
    const original = console[level];
    console[level] = (...args) => said.push(args.join(' '));
    t.after(() => (console[level] = original));
  }
  return said;
}

function scene(t) {
  const renderer = new SceneGraphRenderer({}, createElement('group'));
  t.after(() => {
    renderer.destroy();
    fonts.missing.clear();
    fonts.delay = 0;
  });
  return renderer;
}
const registry = (t, changes = { count: 0 }) => {
  const made = new FontRegistry(createElement('group'), () => changes.count++);
  t.after(() => made.destroy());
  return made;
};
/** The Font nodes under a renderer's (or registry's) root. */
const fontNodes = (root) => root.children.filter((node) => node.type === 'font');
const label = (node) => node.dom.children.find((child) => child.type === 'label');

test('a text node gets the family it names, at the nearest registered weight', (t) => {
  quiet(t);
  const changes = { count: 0 };
  const all = registry(t, changes);
  all.registerFont({ family: 'Roboto', uri: REGULAR, metrics: TABLES[REGULAR] });
  // The platform's way of naming a weight, in loadFonts as in text props.
  all.registerFont({ family: 'Roboto700', uri: BOLD, metrics: TABLES[BOLD] });
  all.registerFont({ family: 'Raleway', weight: 800, uri: RALEWAY, metrics: TABLES[RALEWAY] });
  assert.equal(changes.count, 3);
  const uriOf = (family, weight, style) => {
    const face = all.acquire(family, weight, style, 32);
    all.release(face);
    return face.key;
  };
  assert.equal(uriOf('Roboto'), REGULAR + '@32');
  assert.equal(uriOf('Roboto700'), BOLD + '@32');
  assert.equal(uriOf('Roboto', 700), BOLD + '@32');
  assert.equal(uriOf('Roboto', 'bold'), BOLD + '@32');
  // Not registered weights: 500 is nearer 400, 600 nearer 700; 100 and 900 take the ends.
  assert.equal(uriOf('Roboto500'), REGULAR + '@32');
  assert.equal(uriOf('Roboto600'), BOLD + '@32');
  assert.equal(uriOf('Roboto100'), REGULAR + '@32');
  assert.equal(uriOf('Roboto', 900), BOLD + '@32');
  // A family with one weight draws every weight with it.
  assert.equal(uriOf('Raleway'), RALEWAY + '@32');
  assert.equal(uriOf('Raleway400'), RALEWAY + '@32');
  // The size is part of the face: a SceneGraph Font is a file at a size.
  const face = all.acquire('Roboto', undefined, undefined, 47.6);
  assert.equal(face.key, REGULAR + '@48');
  assert.equal(face.font.measure('Hello', 0), roboto.measure('Hello', 48, 0));
  all.release(face);
});

test('equally near weights: the lighter below 500, the heavier above; a style is matched before a weight', (t) => {
  quiet(t);
  const all = registry(t);
  const table = TABLES[REGULAR];
  for (const weight of [300, 500, 600, 800]) all.registerFont({ family: 'Even', weight, uri: 'w' + weight, metrics: table });
  all.registerFont({ family: 'Even', weight: 300, style: 'italic', uri: 'italic300', metrics: table });
  const uriOf = (weight, style) => {
    const face = all.acquire('Even', weight, style, 20);
    all.release(face);
    return face.key;
  };
  assert.equal(uriOf(400), 'w300@20');
  assert.equal(uriOf(700), 'w800@20');
  assert.equal(uriOf(500), 'w500@20');
  assert.equal(uriOf(800, 'italic'), 'italic300@20');
  assert.equal(uriOf(300, 'normal'), 'w300@20');
});

test('a family that is not registered draws in the system font, said once', (t) => {
  const said = quiet(t);
  const all = registry(t);
  all.registerFont({ family: 'Roboto', uri: REGULAR, metrics: TABLES[REGULAR] });
  const faces = [
    all.acquire('Nope Sans', undefined, undefined, 32),
    all.acquire('Nope Sans', undefined, undefined, 20),
    all.acquire('Nope Sans700', undefined, undefined, 32),
    all.acquire('Nope Sans', 'bold', undefined, 20),
  ];
  assert.deepEqual(
    faces.map((face) => face.key),
    ['font:SystemFontFile@32', 'font:SystemFontFile@20', 'font:BoldSystemFontFile@32', 'font:BoldSystemFontFile@20'],
  );
  assert.equal(said.length, 1);
  assert.match(said[0], /family "Nope Sans" is not registered/);
  // No family at all is not a mistake to report.
  const plain = all.acquire('', undefined, undefined, 32);
  assert.equal(plain.key, 'font:SystemFontFile@32');
  assert.equal(said.length, 1);
  // Another unknown family is another warning.
  faces.push(plain, all.acquire('Other', undefined, undefined, 32));
  assert.equal(said.length, 2);
  assert.match(said[1], /"Other"/);
  faces.forEach((face) => all.release(face));
});

test('loadFont registers the family, publishes a Font node and resolves when the device has the font', async (t) => {
  quiet(t);
  const renderer = scene(t);
  fonts.delay = 40;
  const made = created.font || 0;
  const loading = renderer.loadFont({ fontFamily: 'Roboto', fontUrl: REGULAR });
  // Registered at once: text lays out from the table without waiting for the file.
  const text = renderer.createTextNode({ parent: renderer.root, text: 'Hello World', fontFamily: 'Roboto', fontSize: 32 });
  assert.equal(text.w, roboto.measure('Hello World', 32, 0));
  const [probe] = fontNodes(renderer.rootId);
  // preUpdate first, and the size before the uri: the firmware loads at the size it has when the uri arrives.
  assert.deepEqual(Object.entries(probe.props), [['preUpdate', true], ['size', 32], ['uri', REGULAR]]);
  const started = Date.now();
  await loading;
  assert.ok(Date.now() - started >= 30, 'the load waited for the device');
  renderer.flush();
  // The probe is gone; the Font node left is the one the text draws with.
  assert.deepEqual(fontNodes(renderer.rootId).map((node) => node.props), [{ preUpdate: true, size: 32, uri: REGULAR }]);
  assert.equal(label(text).props.font, fontNodes(renderer.rootId)[0]);
  // One node waited on: the load did not need its second try.
  assert.equal((created.font || 0) - made, 2);
  await wait(20);
  assert.equal(live.size, 0);
});

test('a font file that cannot load rejects within its bound and leaves no timer or poll', async (t) => {
  const said = quiet(t);
  const renderer = scene(t);
  const uri = 'pkg:/fonts/Ghost.ttf';
  registerFontMetrics(uri, TABLES[REGULAR]);
  fonts.missing.add(uri);
  const text = renderer.createTextNode({ parent: renderer.root, text: 'Ghost text', fontFamily: 'Ghost', fontSize: 32 });
  const sizes = [];
  text.on('loaded', (_node, event) => sizes.push(event.dimensions.width));
  const started = Date.now();
  const loading = renderer.loadFont({ fontFamily: 'Ghost', fontUrl: uri, timeout: 120 });
  // While the file may still load, its text is laid out from its table.
  assert.equal(text.w, roboto.measure('Ghost text', 32, 0));
  await assert.rejects(loading, /not loaded after 60 ms/);
  const took = Date.now() - started;
  assert.ok(took >= 110 && took < 400, `rejected after ${took} ms of a 120 ms bound`);
  // The family now draws in the system font (the fake's: 16 px a character), said once.
  await wait(30);
  assert.equal(text.w, 'Ghost text'.length * 16);
  assert.equal(label(text).props.font.props.uri, 'font:SystemFontFile');
  assert.deepEqual(fontNodes(renderer.rootId).map((node) => node.props.uri), ['font:SystemFontFile']);
  assert.deepEqual(said.map((line) => line.replace(/:.*/, '')), ['ROKU_FONT pkg', 'ROKU_FONT family "Ghost" has no font that loaded']);
  // Its size as the listeners heard it: from the table, then none while the
  // system font was not measurable yet, then the system font's.
  assert.deepEqual(sizes, [roboto.measure('Ghost text', 32, 0), 0, 160]);
  // Nothing is left running: no timer, and the poll has stopped.
  assert.equal(live.size, 0);
  const polls = fonts.polls;
  await wait(120);
  assert.equal(fonts.polls, polls);
  assert.equal(live.size, 0);
  // A later load of the file tries again, and works once the file is there.
  fonts.missing.delete(uri);
  await renderer.loadFont({ fontFamily: 'Ghost', fontUrl: uri, timeout: 120 });
  assert.equal(text.w, roboto.measure('Ghost text', 32, 0));
});

test('destroying the renderer ends a load in flight', async (t) => {
  quiet(t);
  const renderer = new SceneGraphRenderer({}, createElement('group'));
  const uri = 'pkg:/fonts/Never.ttf';
  registerFontMetrics(uri, TABLES[REGULAR]);
  fonts.missing.add(uri);
  t.after(() => fonts.missing.clear());
  const loading = renderer.loadFont({ fontFamily: 'Never', fontUrl: uri, timeout: 60_000 });
  await wait(40);
  const started = Date.now();
  renderer.destroy();
  await assert.rejects(loading);
  assert.ok(Date.now() - started < 50);
  await wait(30);
  assert.equal(live.size, 0);
});

test('one file under several names loads once; a second load of it joins the first', async (t) => {
  quiet(t);
  const renderer = scene(t);
  fonts.delay = 20;
  const made = created.font || 0;
  await Promise.all([
    renderer.loadFont({ fontFamily: ['Roboto', 'Body'], aliases: ['Copy'], fontUrl: REGULAR }),
    renderer.loadFont('roku', { fontFamily: 'Roboto', fontUrl: REGULAR }),
    renderer.loadFonts([{ fontFamily: 'Roboto700', fontUrl: BOLD }]),
  ]);
  assert.equal((created.font || 0) - made, 2, 'one Font node per file');
  for (const family of ['Roboto', 'Body', 'Copy'])
    assert.equal(renderer.measureText({ text: 'Hello', fontFamily: family, fontSize: 32 }).w, roboto.measure('Hello', 32, 0));
  assert.notEqual(renderer.measureText({ text: 'Hello', fontFamily: 'Roboto', fontWeight: 700, fontSize: 32 }).w, roboto.measure('Hello', 32, 0));
  // Measuring made no Font node: a table needs none.
  assert.equal((created.font || 0) - made, 2);
});

test('loadFont refuses a font without a file or without a layout table', async (t) => {
  const said = quiet(t);
  const renderer = scene(t);
  await assert.rejects(renderer.loadFont({ fontFamily: 'Roboto' }), /needs fontFamily and fontUrl/);
  await assert.rejects(renderer.loadFont({ fontFamily: 'Typed', fontUrl: 'pkg:/fonts/Typed-By-Hand.ttf' }), /no layout table .* import the font file/);
  // Neither registered anything: the family is still unknown.
  renderer.createTextNode({ parent: renderer.root, text: 'a', fontFamily: 'Typed' }).w;
  assert.match(said[0], /family "Typed" is not registered/);
});

test('text made before its font is registered is laid out again, once, when it is', async (t) => {
  quiet(t);
  const renderer = scene(t);
  const text = renderer.createTextNode({ parent: renderer.root, text: 'Hello World', fontFamily: 'Late', fontSize: 32 });
  const sizes = [];
  text.on('loaded', (_node, event) => sizes.push(event.dimensions));
  renderer.flush();
  await wait(20);
  // The system font, as the fake measures it.
  assert.deepEqual(sizes[sizes.length - 1], { width: 176, height: 32 * 1.2 });
  const before = sizes.length;
  await renderer.loadFont({ fontFamily: 'Late', fontUrl: REGULAR });
  await wait(20);
  const width = roboto.measure('Hello World', 32, 0);
  assert.deepEqual(sizes.slice(before), [{ width, height: text.h }]);
  assert.equal(text.w, width);
  assert.equal(label(text).props.font.props.uri, REGULAR);
  await wait(60);
  assert.equal(sizes.length, before + 1);
  assert.equal(live.size, 0);
});

test('system-font text has no size until the device can measure it, then one', async (t) => {
  quiet(t);
  const renderer = scene(t);
  fonts.delay = 40;
  const text = renderer.createTextNode({ parent: renderer.root, text: 'Hello', fontFamily: 'Nope Sans', fontSize: 30 });
  const sizes = [];
  text.on('loaded', (_node, event) => sizes.push(event.dimensions.width));
  renderer.flush();
  assert.equal(text.w, 0);
  await wait(100);
  assert.equal(text.w, 80);
  assert.equal(label(text).props.text, 'Hello');
  assert.deepEqual(sizes, [0, 80]);
  assert.equal(live.size, 0);
  const polls = fonts.polls;
  await wait(80);
  assert.equal(fonts.polls, polls);
});

test('a Font node per file and size in use, shared by its text and removed with the last of it', (t) => {
  quiet(t);
  const renderer = scene(t);
  renderer.registerFont({ family: 'Roboto', uri: REGULAR, metrics: TABLES[REGULAR] });
  const a = renderer.createTextNode({ parent: renderer.root, text: 'a', fontFamily: 'Roboto', fontSize: 32 });
  const b = renderer.createTextNode({ parent: renderer.root, text: 'b', fontFamily: 'Roboto', fontSize: 32 });
  renderer.flush();
  const sizes = () => fontNodes(renderer.rootId).map((node) => node.props.size).sort((x, y) => x - y);
  assert.deepEqual(sizes(), [32]);
  assert.equal(label(a).props.font, label(b).props.font);
  b.fontSize = 48;
  renderer.flush();
  assert.deepEqual(sizes(), [32, 48]);
  // An animated size leaves one node behind it, not one per frame.
  for (let size = 49; size <= 60; size++) {
    b.fontSize = size;
    renderer.flush();
  }
  assert.deepEqual(sizes(), [32, 60]);
  a.destroy();
  assert.deepEqual(sizes(), [60]);
  b.destroy();
  assert.deepEqual(sizes(), []);
});
