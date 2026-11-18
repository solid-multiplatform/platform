// The host test, run by the desktop runtime itself in a window: an app
// started with `startApp(desktopHost())`, driven by input put on SDL's own
// queue (`__solid.test`) and, where run.mjs has `xdotool`, by real X events.
// Covers focus and activation by key, text fields (typing, composition,
// selection, clipboard, password), pointers and the wheel, resize and scale,
// every service's working and unavailable paths, `fetch` against run.mjs's
// server, the idle check with all of it installed, and closing.
//
// Prints `STEP <name>` when it wants run.mjs to do something from outside,
// `HOST <json>` with its findings, and `DISPOSED` from the app's cleanup.
import { createSignal, onCleanup } from 'solid-js';
import {
  activeElement,
  batteryState,
  Config,
  createShortcuts,
  deviceInfo,
  deviceMemory,
  downloadText,
  fileDirectories,
  fileExists,
  getRenderer,
  hasPointer,
  keepAwake,
  listFiles,
  openExternal,
  pickFiles,
  readClipboard,
  readFileBytes,
  readFileText,
  removeFile,
  rootNode,
  useCapabilities,
  useColorScheme,
  writeClipboard,
  writeFileBytes,
  writeFileText,
  createI18n,
  type ElementNode,
} from '@solid-multiplatform/platform';
import {
  Controls,
  TextArea,
  TextField,
} from '@solid-multiplatform/platform/controls';
import { startApp, type HostContext } from '@solid-multiplatform/platform/host';
import {
  installedServices,
  loadService,
  serviceAvailable,
} from '@solid-multiplatform/platform/services';
import { viewport } from '@solid-multiplatform/platform/viewport';
import type { RendererMain } from '@solid-multiplatform/renderer';
import {
  desktopControls,
  desktopHost,
  DesktopPlatform,
  type DesktopDeviceInfo,
  type DesktopEditorHost,
  type DesktopFileSystemPort,
  type DesktopSurface,
} from '@solid-multiplatform/host-desktop';

interface Setup {
  /** run.mjs's HTTP server. */
  server: string;
  /** A port nothing listens on. */
  refused: number;
  /** An HTTPS server with a certificate no authority signed, if there is one. */
  untrusted?: string;
  /** Whether run.mjs drives real X events. */
  xdotool: boolean;
  /** A file outside the app's directories, and a link to its directory inside them. */
  outside: string;
  /** Where the stand-in for the system's save dialog says to save. */
  saved: string;
  /** How long the idle check watches, in milliseconds. */
  idleMs: number;
}

const failures: string[] = [];
const notes: Record<string, unknown> = {};
let checks = 0;

function check(name: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (!ok) {
    failures.push(detail === undefined ? name : `${name}: ${String(detail)}`);
  }
}
function equal(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  check(name, a === b, `${a} is not ${b}`);
}
async function rejects(
  name: string,
  pattern: RegExp,
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    await action();
    check(name, false, 'did not reject');
  } catch (error) {
    const text = `${(error as Error).name}: ${(error as Error).message}`;
    check(name, pattern.test(text), text);
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
/** Lets the loop take a turn: what was pushed is delivered by then. */
const turn = (): Promise<void> => sleep(0).then(() => sleep(0));
async function until(what: () => boolean, ms = 5000): Promise<boolean> {
  for (let waited = 0; !what() && waited < ms; waited += 20) await sleep(20);
  return what();
}

// SDL's numbers for the keys the test presses: scancode, then keycode.
const SCANCODE_MASK = 1 << 30;
const KEYS = {
  right: [79, SCANCODE_MASK | 79],
  left: [80, SCANCODE_MASK | 80],
  down: [81, SCANCODE_MASK | 81],
  up: [82, SCANCODE_MASK | 82],
  home: [74, SCANCODE_MASK | 74],
  end: [77, SCANCODE_MASK | 77],
  enter: [40, 13],
  escape: [41, 27],
  backspace: [42, 8],
  delete: [76, 127],
  tab: [43, 9],
  a: [4, 97],
  c: [6, 99],
  k: [14, 107],
  v: [25, 118],
  x: [27, 120],
  f5: [62, SCANCODE_MASK | 62],
} as const;
const CTRL = 0x0040;
const SHIFT = 0x0001;

async function press(key: keyof typeof KEYS, modifiers = 0): Promise<void> {
  const [scancode, keycode] = KEYS[key];
  __solid.test!.key(true, scancode, keycode, modifiers);
  __solid.test!.key(false, scancode, keycode, modifiers);
  await turn();
}
async function type(text: string): Promise<void> {
  __solid.test!.text(text);
  await turn();
}
async function click(x: number, y: number): Promise<void> {
  __solid.test!.mouse('move', x, y);
  __solid.test!.mouse('down', x, y, 1);
  __solid.test!.mouse('up', x, y, 1);
  await turn();
}

const renderer = (): RendererMain => getRenderer() as RendererMain;

/** RGBA at points of the next frame, x and y from the top left in pixels. */
function pixels(points: [number, number][]): Promise<number[][]> {
  return new Promise((resolve, reject) => {
    const stage = renderer();
    const read = (): void => {
      stage.off('idle', read);
      try {
        const canvas = stage.canvas;
        const gl = canvas.getContext('webgl') as WebGLRenderingContext;
        resolve(
          points.map(([x, y]) => {
            const rgba = new Uint8Array(4);
            gl.readPixels(
              x,
              canvas.height - 1 - y,
              1,
              1,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              rgba,
            );
            return Array.from(rgba);
          }),
        );
      } catch (error) {
        reject(error as Error);
      }
    };
    stage.on('idle', read);
    stage.requestRender();
  });
}

/** Pixels in a rectangle of the next frame that are nearly white: glyphs. */
function inkIn(
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<number> {
  return new Promise((resolve) => {
    const stage = renderer();
    const read = (): void => {
      stage.off('idle', read);
      const canvas = stage.canvas;
      const gl = canvas.getContext('webgl') as WebGLRenderingContext;
      const data = new Uint8Array(width * height * 4);
      gl.readPixels(
        x,
        canvas.height - y - height,
        width,
        height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        data,
      );
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i]! > 200) ink++;
      resolve(ink);
    };
    stage.on('idle', read);
    stage.requestRender();
  });
}

// What the scene records.
const NAME = { x: 20, y: 200, width: 300, height: 40 };
const SECRET = { x: 20, y: 260, width: 300, height: 40 };
const NOTES = { x: 20, y: 320, width: 300, height: 100 };
const PAD = { x: 400, y: 20, width: 200, height: 100 };
const seen = {
  entered: 0,
  name: '',
  nameChanges: 0,
  submitted: [] as string[],
  blurred: 0,
  secret: '',
  notes: '',
  pad: [] as string[],
  shortcut: 0,
};
let context!: HostContext<DesktopSurface>;
let first!: ElementNode;
let second!: ElementNode;
const [nameValue, setNameValue] = createSignal('');

function App(host: HostContext<DesktopSurface>) {
  context = host;
  onCleanup(() => console.log('DISPOSED'));
  onCleanup(
    host.pointer!.register({
      bounds: () => PAD,
      hover: (active) => seen.pad.push(active ? 'hover' : 'unhover'),
      pressed: (active) => seen.pad.push(active ? 'press' : 'release'),
      activate: (point) => seen.pad.push(`activate ${point?.x},${point?.y}`),
      scroll: (x, y) => seen.pad.push(`scroll ${x},${y}`),
    }),
  );
  return (
    <view width={1280} height={720} color={0x101010ff}>
      <view
        id="first"
        ref={first}
        autofocus
        x={20}
        y={20}
        width={100}
        height={100}
        color={0x4fb3ffff}
        onRight={() => second.setFocus()}
      />
      <view
        id="second"
        ref={second}
        x={140}
        y={20}
        width={100}
        height={100}
        color={0x4fb3ffff}
        onLeft={() => first.setFocus()}
        onEnter={() => {
          seen.entered++;
        }}
      />
      <view
        x={PAD.x}
        y={PAD.y}
        width={PAD.width}
        height={PAD.height}
        color={0x303030ff}
      />
      <Controls surface={desktopControls(host.text!)}>
        <TextField
          label="Name"
          bounds={NAME}
          value={nameValue()}
          onChange={(value) => {
            seen.name = value;
            seen.nameChanges++;
            setNameValue(value);
          }}
          onSubmit={(value) => seen.submitted.push(value)}
          onBlur={() => seen.blurred++}
        />
        <TextField
          label="Password"
          purpose="current-password"
          bounds={SECRET}
          onChange={(value) => (seen.secret = value)}
        />
        <TextArea
          label="Notes"
          bounds={NOTES}
          onChange={(value) => (seen.notes = value)}
        />
      </Controls>
    </view>
  );
}

/** The fields' own scene nodes, to see what they draw. */
function fieldNode(index: number): ElementNode {
  const layer = (rootNode.children as ElementNode[]).find(
    (node) => node.zIndex === 10000,
  )!;
  return layer.children[index] as ElementNode;
}
function drawn(index: number) {
  const field = fieldNode(index);
  const children = field.children as ElementNode[];
  const caret = children[children.length - 1]!;
  const lines = children.slice(0, -1).map((line) => {
    const [selection, text, underline] = line.children as ElementNode[];
    return {
      text: String(text!.text ?? ''),
      selection: Math.round(selection!.width ?? 0),
      underline: Math.round(underline!.width ?? 0),
    };
  });
  return { lines, caretX: caret.x ?? 0, caretShown: caret.width === 1 };
}

async function keysAndFocus(): Promise<void> {
  equal('the first box has focus', activeElement()?.id, 'first');
  await press('enter');
  equal('Enter on a box without a handler does nothing', seen.entered, 0);
  await press('right');
  equal('Right moves focus', activeElement()?.id, 'second');
  await press('enter');
  equal('Enter activates', seen.entered, 1);
  await press('left');
  equal('Left moves focus back', activeElement()?.id, 'first');

  // What a key event carries, read by a listener on the host's key source.
  const heard: string[] = [];
  const listen = (event: KeyboardEvent): void => {
    heard.push(
      [
        event.type,
        event.key,
        event.code,
        event.keyCode,
        event.repeat,
        event.ctrlKey,
        event.shiftKey,
      ].join(' '),
    );
  };
  const keys = context.keys as unknown as EventTarget;
  keys.addEventListener('keydown', listen as EventListener);
  keys.addEventListener('keyup', listen as EventListener);
  __solid.test!.key(true, 79, SCANCODE_MASK | 79, 0, false);
  __solid.test!.key(true, 79, SCANCODE_MASK | 79, 0, true);
  __solid.test!.key(false, 79, SCANCODE_MASK | 79);
  __solid.test!.key(true, 4, 97, CTRL | SHIFT);
  __solid.test!.key(true, 62, SCANCODE_MASK | 62);
  __solid.test!.key(true, 44, 32);
  __solid.test!.key(true, 271, SCANCODE_MASK | 271);
  await turn();
  keys.removeEventListener('keydown', listen as EventListener);
  keys.removeEventListener('keyup', listen as EventListener);
  equal('key events', heard, [
    'keydown ArrowRight ArrowRight 39 false false false',
    'keydown ArrowRight ArrowRight 39 true false false',
    'keyup ArrowRight ArrowRight 39 false false false',
    'keydown A KeyA 65 false true true',
    'keydown F5 F5 116 false false false',
    'keydown   Space 32 false false false',
    'keydown MediaPlayPause MediaPlayPause 179 false false false',
  ]);
  check('a key event is a KeyboardEvent', typeof KeyboardEvent === 'function');
  // Focus moved right twice above (the press and its repeat reach the
  // second box, which has no onRight): back to the first.
  first.setFocus();
  await turn();

  // The keyEvents service: a shortcut with the system's own modifier.
  const shortcuts = createShortcuts([
    { combo: 'Mod+K', handler: () => (seen.shortcut++, true) },
  ]);
  await press('k');
  equal('K alone is not Mod+K', seen.shortcut, 0);
  await press('k', CTRL);
  equal('Ctrl+K is Mod+K here', seen.shortcut, 1);
  shortcuts.dispose();
  await press('k', CTRL);
  equal('a disposed shortcut is gone', seen.shortcut, 1);
}

async function textFields(): Promise<void> {
  const text = context.text as DesktopEditorHost;
  check('the host has an editor host', typeof text.createEditor === 'function');
  check('no text input before a field has focus', !__solid.text!.active());
  equal('fields are drawn unfocused', drawn(0).caretShown, false);

  // A click in the field gives it the keyboard.
  await click(NAME.x + 10, NAME.y + 20);
  check('a click focuses the field', __solid.text!.active());
  check('the caret shows', drawn(0).caretShown);
  await type('héllo');
  equal('typing reaches onChange', seen.name, 'héllo');
  equal('typing is drawn', drawn(0).lines[0]!.text, 'héllo');
  check('the caret is after the text', drawn(0).caretX > 20, drawn(0).caretX);

  // While it has the keyboard, keys are the field's, not the focus tree's.
  await press('right');
  equal('arrow keys stay in the field', activeElement()?.id, 'first');
  await press('enter');
  equal('Enter submits', seen.submitted, ['héllo']);
  equal('Enter in the field activates nothing', seen.entered, 1);

  // An input method composes: nothing is committed until it says so.
  const before = seen.nameChanges;
  __solid.test!.text('n', 1, 0);
  await turn();
  __solid.test!.text('に', 1, 0);
  await turn();
  __solid.test!.text('にほ', 2, 0);
  await turn();
  equal(
    'a composition is drawn in place',
    drawn(0).lines[0]!.text,
    'hélloにほ',
  );
  check('the composition is underlined', drawn(0).lines[0]!.underline > 0);
  equal(
    'a composition changes no value',
    [seen.name, seen.nameChanges - before],
    ['héllo', 0],
  );
  await press('backspace');
  equal("keys during a composition are the input method's", seen.name, 'héllo');
  __solid.test!.text('', 0, 0);
  __solid.test!.text('日本');
  await turn();
  equal('the commit replaces the composition', seen.name, 'héllo日本');
  equal('the underline is gone', drawn(0).lines[0]!.underline, 0);

  // Deleting and moving go by user-perceived characters.
  await type('👨‍👩‍👧é');
  await press('backspace');
  equal('Backspace removes one combined character', seen.name, 'héllo日本👨‍👩‍👧');
  await press('backspace');
  equal('Backspace removes a whole emoji sequence', seen.name, 'héllo日本');
  await press('home');
  await press('delete');
  equal('Delete removes ahead of the caret', seen.name, 'éllo日本');
  equal('the caret is at the start', drawn(0).caretX, 6);

  // Selection: Shift+arrows, then typing replaces it.
  await press('right', SHIFT);
  await press('right', SHIFT);
  check('a selection is drawn', drawn(0).lines[0]!.selection > 0);
  await type('HE');
  equal('typing replaces the selection', seen.name, 'HElo日本');

  // Clipboard: select all, copy, cut, paste.
  await press('a', CTRL);
  await press('c', CTRL);
  equal('Ctrl+C copies the selection', await readClipboard(), 'HElo日本');
  await press('x', CTRL);
  equal('Ctrl+X cuts', seen.name, '');
  await press('v', CTRL);
  await press('v', CTRL);
  equal('Ctrl+V pastes', seen.name, 'HElo日本HElo日本');
  await writeClipboard('two\nlines');
  await press('a', CTRL);
  await press('v', CTRL);
  equal('a single line takes no line break', seen.name, 'twolines');
  equal(
    'the clipboard service round-trips',
    await readClipboard(),
    'two\nlines',
  );

  // A controlled value: the app sets it, the field shows it.
  setNameValue('set by the app');
  await turn();
  equal('setValue is drawn', drawn(0).lines[0]!.text, 'set by the app');

  // What it looks like: the field's focused background, and glyphs in it.
  const [background] = await pixels([[NAME.x + 290, NAME.y + 35]]);
  equal('the focused field is drawn', background, [0x29, 0x3c, 0x52, 0xff]);
  check(
    'its text is drawn',
    (await inkIn(NAME.x, NAME.y, 200, NAME.height)) > 50,
  );

  // A click on the other field moves the keyboard there.
  await click(SECRET.x + 10, SECRET.y + 20);
  equal(
    'focus moved to the password field',
    [drawn(0).caretShown, drawn(1).caretShown],
    [false, true],
  );
  equal('the first field heard its blur', seen.blurred, 1);
  await type('pa55wörd');
  equal('a password reaches onChange', seen.secret, 'pa55wörd');
  equal('a password is drawn as dots', drawn(1).lines[0]!.text, '••••••••');
  await writeClipboard('untouched');
  await press('a', CTRL);
  await press('c', CTRL);
  equal('a password is not copied', await readClipboard(), 'untouched');
  await press('escape');
  check('Escape gives the keyboard back', !__solid.text!.active());

  // Several lines.
  await click(NOTES.x + 10, NOTES.y + 10);
  await type('one');
  await press('enter');
  await type('two');
  equal('Enter breaks a line in a text area', seen.notes, 'one\ntwo');
  equal(
    'each line is drawn',
    drawn(2).lines.map((line) => line.text),
    ['one', 'two'],
  );
  await press('up');
  await press('end');
  await type('!');
  equal('Up moves to the line above', seen.notes, 'one!\ntwo');
  // Tab leaves the field.
  await press('tab');
  check('Tab gives the keyboard back', !__solid.text!.active());

  // A press outside any field takes the keyboard from it.
  await click(NAME.x + 10, NAME.y + 20);
  check('focused again', __solid.text!.active());
  await click(700, 600);
  check('a press elsewhere blurs the field', !__solid.text!.active());
  // Function keys are never the field's.
  await click(NAME.x + 10, NAME.y + 20);
  let functionKeys = 0;
  const count = (): void => void functionKeys++;
  (context.keys as unknown as EventTarget).addEventListener('keydown', count);
  await press('f5');
  await press('a');
  (context.keys as unknown as EventTarget).removeEventListener(
    'keydown',
    count,
  );
  equal(
    'a function key passes a focused field, a letter does not',
    functionKeys,
    1,
  );
  await press('escape');
}

async function pointers(): Promise<void> {
  check('the desktop has a pointer', hasPointer());
  equal('inputs', useCapabilities().inputs, ['keyboard', 'mouse']);
  seen.pad.length = 0;
  __solid.test!.mouse('move', PAD.x + 10, PAD.y + 10);
  await turn();
  equal('hover', seen.pad, ['hover']);
  __solid.test!.mouse('down', PAD.x + 10, PAD.y + 10, 1);
  await turn();
  __solid.test!.mouse('up', PAD.x + 12, PAD.y + 10, 1);
  await turn();
  equal('press and click', seen.pad, [
    'hover',
    'press',
    'release',
    `activate ${PAD.x + 12},${PAD.y + 10}`,
  ]);
  // The right button presses nothing.
  seen.pad.length = 0;
  __solid.test!.mouse('down', PAD.x + 10, PAD.y + 10, 3);
  __solid.test!.mouse('up', PAD.x + 10, PAD.y + 10, 3);
  await turn();
  equal('the right button does not click', seen.pad, []);
  // One notch towards the user scrolls down by three lines; two notches in
  // one turn arrive as one event.
  __solid.test!.mouse('wheel', PAD.x + 10, PAD.y + 10, 0, 0, -1);
  await turn();
  __solid.test!.mouse('wheel', PAD.x + 10, PAD.y + 10, 0, 1, 1);
  __solid.test!.mouse('wheel', PAD.x + 10, PAD.y + 10, 0, 0, 1);
  await turn();
  equal('wheel', seen.pad, ['scroll 0,48', 'scroll 48,-96']);
  seen.pad.length = 0;
  __solid.test!.mouse('move', 700, 600);
  await turn();
  __solid.test!.mouse('move', PAD.x + 10, PAD.y + 10);
  __solid.test!.window('leave');
  await turn();
  equal('leaving the control and the window', seen.pad, [
    'unhover',
    'hover',
    'unhover',
  ]);
  // A touch presses without hovering.
  seen.pad.length = 0;
  __solid.test!.finger('down', 7, PAD.x + 20, PAD.y + 20);
  await turn();
  __solid.test!.finger('up', 7, PAD.x + 20, PAD.y + 20);
  await turn();
  // A touch's position is a fraction of the window in single precision.
  equal(
    'touch',
    seen.pad.map((entry) =>
      entry.replace(/\d+\.\d+/g, (n) => String(Math.round(Number(n)))),
    ),
    ['press', 'release', `activate ${PAD.x + 20},${PAD.y + 20}`],
  );
  // A press that loses the window's focus is cancelled, not clicked.
  seen.pad.length = 0;
  __solid.test!.mouse('down', PAD.x + 10, PAD.y + 10, 1);
  await turn();
  __solid.test!.window('blur');
  await turn();
  __solid.test!.mouse('up', PAD.x + 10, PAD.y + 10, 1);
  await turn();
  equal(
    'blur cancels a press',
    seen.pad.filter((entry) => entry.startsWith('activate')),
    [],
  );
}

/** Asks run.mjs to act on the window from outside, with real X events. */
async function real(setup: Setup): Promise<void> {
  if (!setup.xdotool) {
    notes.xdotool = false;
    return;
  }
  notes.xdotool = true;
  first.setFocus();
  await turn();
  const entered = seen.entered;
  console.log('STEP keys');
  check(
    'real keys: Right then Return activate the second box',
    await until(() => seen.entered === entered + 1),
  );
  equal('real keys: focus', activeElement()?.id, 'second');

  // Typing through the X server: the layout, Shift and text input are SDL's.
  setNameValue('');
  seen.name = '';
  await click(NAME.x + 10, NAME.y + 20);
  console.log('STEP type');
  check('real typing', await until(() => seen.name === 'Hi 5!'), seen.name);
  await press('escape');

  seen.pad.length = 0;
  console.log('STEP mouse');
  const clicked = await until(() =>
    seen.pad.some((entry) => entry.startsWith('scroll')),
  );
  check('real mouse: move, click and wheel', clicked, seen.pad.join(' | '));
  equal('real mouse: what the control saw', seen.pad, [
    'hover',
    'press',
    'release',
    `activate ${PAD.x + 50},${PAD.y + 40}`,
    'scroll 0,48',
  ]);

  // The lifecycle service, with the window really unmapped and mapped.
  const lifecycle = await loadService('lifecycle');
  check('lifecycle: active with a focused window', lifecycle.active());
  const states: boolean[] = [];
  const stop = lifecycle.subscribe((active) => states.push(active));
  console.log('STEP unmap');
  check(
    'lifecycle: inactive when the window is hidden',
    await until(() => states.includes(false)),
    states,
  );
  check('lifecycle: active() agrees', !lifecycle.active());
  console.log('STEP map');
  check(
    'lifecycle: active again when it is shown',
    await until(() => states[states.length - 1] === true),
    states,
  );
  stop();
}

async function services(setup: Setup): Promise<void> {
  notes.services = installedServices();
  for (const absent of [
    'connectivity',
    'secureStorage',
    'notifications',
    'share',
    'haptics',
    'links',
  ] as const) {
    equal(`${absent} is unavailable`, serviceAvailable(absent), 'unavailable');
  }
  await rejects(
    'an absent service rejects by name',
    /CapabilityError.*connectivity/,
    () => loadService('connectivity'),
  );

  const info = (await deviceInfo()) as DesktopDeviceInfo;
  equal(
    'deviceInfo',
    [info.platform, info.os, info.appVersion, typeof info.arch],
    ['desktop', 'linux', '1.2.3', 'string'],
  );
  check(
    'deviceInfo has the system version',
    typeof info.osVersion === 'string' && info.osVersion.length > 3,
    info.osVersion,
  );

  // A machine without a battery reports none, and one with a battery its
  // level: whichever this machine is, the service must agree with it.
  const power = __solid.system.power();
  const battery = await batteryState();
  notes.battery = power.state;
  if (
    power.state === 'none' ||
    power.state === 'unknown' ||
    power.percent === undefined
  ) {
    equal('no battery: nothing to report', battery, undefined);
  } else {
    check(
      'battery level',
      battery !== undefined && battery.level >= 0 && battery.level <= 1,
      JSON.stringify(battery),
    );
  }

  const memory = deviceMemory();
  check(
    'memory',
    (memory.deviceMemoryGb ?? 0) > 0.1 && memory.lowMemory === false,
    JSON.stringify(memory),
  );
  check(
    "memory: an app's threshold applies",
    deviceMemory(100000).lowMemory === true,
  );

  // The runtime starts with the screen saver allowed; an app asks otherwise.
  check(
    'the screen saver is allowed at start',
    __solid.window!.screenSaverAllowed(),
  );
  await keepAwake(true);
  check(
    'keepAwake(true) keeps the screen on',
    !__solid.window!.screenSaverAllowed(),
  );
  await keepAwake(false);
  check(
    'keepAwake(false) allows it again',
    __solid.window!.screenSaverAllowed(),
  );

  const scheme = await loadService('colorScheme');
  check('colorScheme', ['light', 'dark'].includes(scheme.current()));
  equal('the host bound the colour scheme', useColorScheme(), scheme.current());
  let themes = 0;
  const stopTheme = scheme.subscribe(() => themes++);
  __solid.test!.window('theme');
  await turn();
  stopTheme();
  __solid.test!.window('theme');
  await turn();
  equal('a theme change reaches subscribers until they stop', themes, 1);

  // run.mjs set the system's language to French (France).
  equal('locale', (await loadService('locale')).current(), 'fr-FR');
  equal("i18n starts in the system's language", createI18n().locale(), 'fr-FR');

  const settings = await loadService('settings');
  equal('settings: nothing before a set', await settings.get('volume'), null);
  await Promise.all([
    settings.set('volume', '7'),
    settings.set('name', 'héllo "quoted"'),
    settings.set('gone', 'x'),
  ]);
  await settings.remove('gone');
  equal(
    'settings: get',
    [
      await settings.get('volume'),
      await settings.get('name'),
      await settings.get('gone'),
    ],
    ['7', 'héllo "quoted"', null],
  );
  const stored = await new Promise<string | null | undefined>((resolve) =>
    __solid.store.load('solid.test.host', (_error, text) => resolve(text)),
  );
  equal('settings: the file', JSON.parse(stored ?? '{}'), {
    volume: '7',
    name: 'héllo "quoted"',
  });

  await files(setup);

  await openExternal('https://example.com/a?b=c');
  await rejects('openExternal refuses a file URL', /only http/, () =>
    openExternal('file:///etc/passwd'),
  );
  await rejects("openExternal refuses a program's scheme", /only http/, () =>
    openExternal('vscode://x'),
  );
}

async function files(setup: Setup): Promise<void> {
  const fs = (await loadService('fileSystem')) as DesktopFileSystemPort;
  const dirs = fileDirectories();
  const data = fs.dataDirectory!;
  notes.directories = {
    data: !!data,
    cache: !!dirs.cache,
    documents: !!dirs.documents,
  };
  check('fileSystem: directories', !!data && !!dirs.cache && !!dirs.documents);
  check(
    "fileSystem: the directories carry the app's id",
    [data, dirs.cache, dirs.documents].every((dir) =>
      dir!.includes('solid.test.host'),
    ),
  );

  const file = `${data}/notes/first.txt`;
  check('fileSystem: nothing there yet', !(await fileExists(file)));
  await writeFileText(file, 'héllo\n');
  equal('fileSystem: text', await readFileText(file), 'héllo\n');
  check('fileSystem: exists', await fileExists(file));
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
  await writeFileBytes(`${data}/notes/all.bin`, bytes);
  equal(
    'fileSystem: bytes',
    Array.from(await readFileBytes(`${data}/notes/all.bin`)),
    Array.from(bytes),
  );
  const listed = await listFiles(`${data}/notes`);
  equal(
    'fileSystem: list',
    listed.map((entry) => [entry.name, entry.size, entry.mimeType]),
    [
      ['all.bin', 256, undefined],
      ['first.txt', 7, 'text/plain'],
    ],
  );
  check(
    'fileSystem: list gives usable paths',
    listed[1]!.path === file && (listed[1]!.modified ?? 0) > 1e12,
  );
  const stat = await fs.stat(file);
  equal(
    'fileSystem: stat',
    [stat?.name, stat?.size, stat?.directory],
    ['first.txt', 7, false],
  );
  equal(
    'fileSystem: stat of nothing',
    await fs.stat(`${data}/absent`),
    undefined,
  );
  equal('fileSystem: list of nothing', await listFiles(`${data}/absent`), []);
  await writeFileText(`${dirs.cache}/c.txt`, 'cache');
  await writeFileText(`${dirs.documents}/d.txt`, 'documents');
  equal(
    'fileSystem: cache and documents',
    [
      await readFileText(`${dirs.cache}/c.txt`),
      await readFileText(`${dirs.documents}/d.txt`),
    ],
    ['cache', 'documents'],
  );
  await removeFile(file);
  await removeFile(file);
  check('fileSystem: remove', !(await fileExists(file)));
  await removeFile(`${data}/notes`);
  check(
    'fileSystem: remove a directory',
    !(await fileExists(`${data}/notes/all.bin`)),
  );

  // Out of the app's directories there is no way.
  const refused = /outside the app's directories|one of the app's directories/;
  await rejects('traversal: ..', refused, () =>
    readFileText(`${data}/../settings.json`),
  );
  await rejects('traversal: .. deeper', refused, () =>
    readFileText(`${data}/a/../../settings.json`),
  );
  await rejects('traversal: an absolute path elsewhere', refused, () =>
    readFileText(setup.outside),
  );
  await rejects('traversal: /etc/passwd', refused, () =>
    readFileText('/etc/passwd'),
  );
  await rejects('traversal: a relative path', refused, () =>
    readFileText('first.txt'),
  );
  await rejects(
    'traversal: a sibling whose name starts the same',
    refused,
    () => readFileText(`${data}-other/x`),
  );
  // run.mjs put a link in the data directory that points outside.
  await rejects('traversal: through a symbolic link', refused, () =>
    readFileText(`${data}/escape/secret.txt`),
  );
  await rejects('traversal: write through a link', refused, () =>
    writeFileText(`${data}/escape/planted.txt`, 'x'),
  );
  await rejects('traversal: list through a link', refused, () =>
    listFiles(`${data}/escape`),
  );
  await rejects('traversal: remove through a link', refused, () =>
    removeFile(`${data}/escape/secret.txt`),
  );
  await rejects('traversal: write outside', refused, () =>
    writeFileText(`${setup.outside}.new`, 'x'),
  );
  await rejects('traversal: exists does not probe outside', refused, () =>
    fileExists('/etc/passwd'),
  );
  await rejects('a directory handed out is not removed', refused, () =>
    removeFile(data),
  );
  await rejects('a NUL in a path', /./, () => readFileText(`${data}/a\0b`));
  equal(
    'the file outside is untouched',
    await new DesktopPlatform()
      .fetch(setup.outside, 'arraybuffer')
      .then((b) => (b as ArrayBuffer).byteLength),
    6,
  );

  // The file dialogs: run.mjs stands in for the system's (its `zenity`
  // prints what the file named reply says), so the path through SDL's
  // dialog thread is real and no window opens.
  const reply = `${data}/dialog-reply`;
  await writeFileText(reply, `${data}/picked.txt\n`);
  await writeFileText(`${data}/picked.txt`, 'picked!');
  const picked = await pickFiles({ accept: '.txt,image/*' });
  equal(
    'filePicker',
    picked.map((entry) => [entry.name, entry.type, entry.size]),
    [['picked.txt', 'text/plain', 7]],
  );
  equal(
    'filePicker: text and bytes',
    [await picked[0]!.text(), (await picked[0]!.bytes()).length],
    ['picked!', 7],
  );
  await writeFileText(reply, 'CANCEL');
  equal('filePicker: cancelled', await pickFiles(), []);
  await writeFileText(reply, `${setup.saved}\n`);
  await downloadText('saved text', 'report.txt');
  equal(
    'download: written where the dialog said',
    await new DesktopPlatform()
      .fetch(setup.saved, 'arraybuffer')
      .then((b) => (b as ArrayBuffer).byteLength),
    10,
  );
  await rejects('download: a name is not a path', /file name/, () =>
    downloadText('x', '../evil.txt'),
  );
}

async function requests(setup: Setup): Promise<void> {
  const { fetch } = await loadService('request');
  check('fetch is a global too', typeof globalThis.fetch === 'function');
  const hello = await fetch(`${setup.server}/hello?x=1`, {
    headers: { 'x-ask': 'héllo'.normalize('NFD').replace(/[^\x20-\x7e]/g, '') },
  });
  equal(
    'fetch: status and text',
    [hello.status, hello.ok, hello.statusText, await hello.text()],
    [200, true, 'OK', 'hello GET /hello?x=1 hello'],
  );
  equal(
    'fetch: headers',
    [hello.headers.get('content-type'), hello.headers.get('X-Test'), hello.url],
    ['text/plain; charset=utf-8', 'yes', `${setup.server}/hello?x=1`],
  );
  const missing = await fetch(`${setup.server}/missing`);
  equal(
    'fetch: 404 is a response',
    [missing.status, missing.ok, await missing.text()],
    [404, false, 'nope'],
  );
  const all = await globalThis.fetch(`${setup.server}/bytes`);
  equal(
    'fetch: binary body',
    Array.from(new Uint8Array(await all.arrayBuffer())),
    Array.from({ length: 256 }, (_, index) => index),
  );
  const body = Uint8Array.from([0, 255, 1, 254, 0, 13, 10]);
  const echoed = await fetch(`${setup.server}/echo`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-test' },
  });
  equal(
    'fetch: POST bytes',
    [
      echoed.headers.get('x-method'),
      echoed.headers.get('content-type'),
      Array.from(new Uint8Array(await echoed.arrayBuffer())),
    ],
    ['POST', 'application/x-test', Array.from(body)],
  );
  const json = await fetch(`${setup.server}/json`);
  equal('fetch: json', await json.json(), {
    greeting: 'héllo wörld',
    list: [1, 2, 3],
  });
  const zipped = await fetch(`${setup.server}/gzip`);
  equal('fetch: gzip is decoded', (await zipped.text()).length, 5000);
  const followed = await fetch(`${setup.server}/redirect`);
  equal(
    'fetch: a redirect is followed',
    [followed.status, followed.redirected, followed.url],
    [200, true, `${setup.server}/hello`],
  );
  const manual = await fetch(`${setup.server}/redirect`, {
    redirect: 'manual',
  });
  equal(
    'fetch: redirect manual',
    [manual.status, manual.headers.get('location')],
    [302, '/hello'],
  );
  await rejects('fetch: redirect error', /TypeError/, () =>
    fetch(`${setup.server}/redirect`, { redirect: 'error' }),
  );

  // Abort: the promise rejects at once, not when the slow server answers.
  const controller = new AbortController();
  const started = performance.now();
  const slow = fetch(`${setup.server}/slow`, { signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  await rejects('fetch: abort', /AbortError/, () => slow);
  const took = performance.now() - started;
  check(
    'fetch: abort does not wait for the server',
    took < 1000,
    `${Math.round(took)} ms`,
  );
  const already = new AbortController();
  already.abort();
  await rejects('fetch: an aborted signal', /AbortError/, () =>
    fetch(`${setup.server}/hello`, { signal: already.signal }),
  );
  await rejects('fetch: connection refused', /TypeError/, () =>
    fetch(`http://127.0.0.1:${setup.refused}/`),
  );
  await rejects('fetch: not http', /TypeError/, () =>
    fetch('file:///etc/passwd'),
  );
  if (setup.untrusted !== undefined) {
    // TLS is on and certificates are checked: one nobody signed is refused.
    await rejects('fetch: an untrusted certificate', /TypeError/, () =>
      fetch(`${setup.untrusted}/hello`),
    );
    notes.tls = 'untrusted certificate refused';
  } else {
    notes.tls = 'not tested: no openssl to make a certificate';
  }

  // The renderer's asset loader takes http URLs.
  const platform = new DesktopPlatform();
  equal(
    'assets: json over http',
    await platform.fetch(`${setup.server}/json`, 'json'),
    { greeting: 'héllo wörld', list: [1, 2, 3] },
  );
  equal(
    'assets: bytes over http',
    (
      (await platform.fetch(
        `${setup.server}/bytes`,
        'arraybuffer',
      )) as ArrayBuffer
    ).byteLength,
    256,
  );
  await rejects('assets: a 404 is a failure', /HTTP 404/, () =>
    platform.fetch(`${setup.server}/missing`, 'arraybuffer'),
  );
  const image = await platform.createImageBitmap(
    (await platform.fetch(`${setup.server}/pixel.png`, 'blob')) as Blob,
  );
  equal(
    'assets: an image over http decodes',
    [image.width, image.height],
    [1, 1],
  );
}

async function resizing(): Promise<void> {
  equal(
    'viewport at start',
    [viewport().width, viewport().height, viewport().scale],
    [1280, 720, 1],
  );
  __solid.window!.setSize(500, 300);
  check(
    'a resize reaches the viewport',
    await until(() => viewport().width === 500 && viewport().height === 300),
    `${viewport().width} x ${viewport().height}`,
  );
  const [inside, outside] = await pixels([
    [60, 60],
    [495, 295],
  ]);
  equal(
    'the scene is drawn at the new size',
    [inside, outside],
    [
      [0x4f, 0xb3, 0xff, 0xff],
      [0x10, 0x10, 0x10, 0xff],
    ],
  );
  equal(
    'the surface follows',
    [context.surface.width, context.surface.height, renderer().canvas.width],
    [500, 300, 500],
  );

  // The display's scale doubles: the same pixels are half as many units.
  __solid.test!.setScale(2);
  check(
    'a scale change reaches the viewport',
    await until(() => viewport().scale === 2),
    JSON.stringify(viewport()),
  );
  equal(
    'units, scale and pixels',
    [
      viewport().width,
      viewport().height,
      viewport().framebufferWidth,
      viewport().framebufferHeight,
    ],
    [250, 150, 500, 300],
  );
  // The box at 20..120 units is at 40..240 pixels now.
  const scaled = await pixels([
    [200, 200],
    [250, 250],
    [30, 30],
  ]);
  equal('the scene is drawn at the new scale', scaled, [
    [0x4f, 0xb3, 0xff, 0xff],
    [0x10, 0x10, 0x10, 0xff],
    [0x10, 0x10, 0x10, 0xff],
  ]);
  __solid.test!.setScale(0);
  check(
    'and back',
    await until(() => viewport().scale === 1 && viewport().width === 500),
  );
}

async function idle(setup: Setup): Promise<void> {
  // Everything is installed and has been used: nothing may be left running.
  await sleep(300);
  const before = __solid.stats();
  await sleep(setup.idleMs);
  const after = __solid.stats();
  const result = {
    ms: setup.idleMs,
    wakeups: after.wakeups - before.wakeups,
    frames: after.frames - before.frames,
    presents: after.presents - before.presents,
  };
  notes.idle = result;
  check(
    'idle: only the timer that ends the wait wakes the loop',
    result.wakeups <= 1,
    `${result.wakeups} wakeups`,
  );
  equal(
    'idle: no frames, nothing presented',
    [result.frames, result.presents],
    [0, 0],
  );
}

async function run(): Promise<void> {
  const setup = (await new DesktopPlatform().fetch(
    'setup.json',
    'json',
  )) as Setup;
  Config.fontSettings = { fontFamily: 'Lato', fontSize: 32 };
  const stop = startApp(
    desktopHost({
      id: 'solid.test.host',
      version: '1.2.3',
      title: 'Solid host test',
    }),
    App,
    {
      fonts: [
        {
          type: 'msdf',
          fontFamily: 'Lato',
          atlasDataUrl: 'fonts/Lato-Regular.msdf.json',
          atlasUrl: 'fonts/Lato-Regular.msdf.png',
        },
      ] as never,
    },
  );
  equal('launch returns nothing', stop, undefined);
  // The first frame, then the font.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await until(
    () =>
      drawn(0) !== undefined &&
      (getRenderer() as RendererMain).measureText({
        text: 'x',
        fontFamily: 'Lato',
        fontSize: 20,
      }) !== null,
  );

  await keysAndFocus();
  await textFields();
  await pointers();
  await real(setup);
  await services(setup);
  await requests(setup);
  await resizing();
  await idle(setup);

  console.log('HOST ' + JSON.stringify({ checks, failures, notes }));
  // Closing: the window is asked to close, the app's cleanup runs, the
  // process ends with status 0. The request is put on SDL's queue: a real
  // one comes from a window manager, and the test display has none.
  __solid.test!.window('close');
  await sleep(5000);
  console.error('the close request did not end the app');
  __solid.exit(3);
}

run().catch((error) => {
  console.error(error);
  console.log(
    'HOST ' +
      JSON.stringify({
        checks,
        failures: [...failures, `threw: ${String(error)}`],
        notes,
      }),
  );
  __solid.exit(1);
});
