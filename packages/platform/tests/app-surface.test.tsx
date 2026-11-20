// The `/app` authoring surface: Screen, Text, Button, List, Spacer, the
// hooks, and the entry the CLI generates around an app's default export.
//
// jsdom measures no text, and flex waits for a text child to have a size:
// the cases that check positions use views or give the label its size, as a
// drawing backend does when the text loads.
import * as v from 'vitest';
import { createComponent, createRoot, createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import {
  Button,
  List,
  Screen,
  Spacer,
  Text,
  available,
  defineTheme,
  useBattery,
  useColorScheme,
  useConnectivity,
  useHost,
  useLifecycle,
  useLocale,
  usePlugin,
  usePlugins,
  useTheme,
  useViewport,
} from '@solid-multiplatform/platform/app';
import {
  appEntry,
  type AppSettings,
} from '@solid-multiplatform/platform/app/entry';
import { useFocusManager } from '@solid-multiplatform/platform/focusManager';
import { HostScope } from '../src/app/context.js';
import { createScenePointer } from '../src/sdk/input.js';
import { installServices } from '../src/sdk/registry.js';
import { sceneSemantics } from '../src/sdk/semantics.js';
import { updateViewport, zeroInsets } from '../src/sdk/viewport.js';
import { KeyTarget } from './contract-focus-helpers.js';
import { renderer } from './setup.js';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
const resize = (width: number, height: number, safeArea = zeroInsets) =>
  updateViewport(
    {
      width,
      height,
      scale: 1,
      safeArea,
      keyboardInset: 0,
      reducedMotion: false,
    },
    null,
  );

let dispose: (() => void) | undefined;
let keys: KeyTarget;
/** The Screen's column; its parent is the node that fills the viewport. */
let column!: lng.ElementNode;

async function mount(
  app: () => lng.JSX.Element,
  plugins: Record<string, unknown> = {},
  settings: AppSettings = {},
) {
  keys = new KeyTarget();
  const entry = appEntry(app, plugins, settings);
  const before = lng.rootNode.children.slice();
  const stop = renderer.render(() => {
    useFocusManager(undefined, keys);
    return createComponent(HostScope.Provider, {
      value: { target: 'android-tv', native: 'view' },
      get children() {
        return entry.root();
      },
    });
  });
  dispose = () => {
    stop();
    for (const child of lng.rootNode.children.slice()) {
      if (before.includes(child)) continue;
      lng.rootNode.removeChild(child);
      (child as lng.ElementNode).destroy();
    }
  };
  await settle();
}
async function press(key: string) {
  keys.down(key);
  keys.up(key);
  await settle();
}
v.afterEach(() => {
  dispose?.();
  dispose = undefined;
  resize(1920, 1080);
});

v.describe('Screen', () => {
  v.test(
    'fills the viewport and pads its column by the safe area',
    async () => {
      resize(400, 800, { top: 40, right: 0, bottom: 20, left: 10 });
      await mount(() => (
        <Screen ref={column} padding={8} gap={4}>
          <view width={50} height={30} />
          <Spacer />
          <view width={50} height={30} />
        </Screen>
      ));
      const outer = column.parent!;
      v.expect([outer.width, outer.height]).toEqual([400, 800]);
      // Inset by the safe area plus the padding on each side.
      v.expect([column.x, column.y, column.width, column.height]).toEqual([
        18,
        48,
        400 - 18 - 8,
        800 - 48 - 28,
      ]);
      const [first, spacer, last] = column.children as lng.ElementNode[];
      v.expect([first!.x, first!.y]).toEqual([0, 0]);
      // The spacer takes what the two views and the gaps leave.
      v.expect(spacer!.height).toBe(724 - 30 - 30 - 4 - 4);
      v.expect(last!.y).toBe(724 - 30);
    },
  );

  v.test('keeps its content above the software keyboard', async () => {
    resize(400, 800);
    await mount(() => (
      <Screen ref={column} padding={8} gap={4}>
        <view width={50} height={30} />
        <Spacer />
        <view width={50} height={30} />
      </Screen>
    ));
    v.expect(column.height).toBe(800 - 16);
    // The keyboard inset arrives with a viewport update (the memo, not a frame).
    updateViewport(
      {
        width: 400,
        height: 800,
        scale: 1,
        safeArea: zeroInsets,
        keyboardInset: 300,
        reducedMotion: false,
      },
      null,
    );
    v.expect([column.y, column.height]).toEqual([8, 800 - 8 - (300 + 8)]);
    // The safe area still wins when it is larger than the keyboard.
    updateViewport(
      {
        width: 400,
        height: 800,
        scale: 1,
        safeArea: { top: 0, right: 0, bottom: 420, left: 0 },
        keyboardInset: 300,
        reducedMotion: false,
      },
      null,
    );
    v.expect(column.height).toBe(800 - 8 - (420 + 8));
  });

  v.test(
    'scales a design size: extend fills, contain letterboxes',
    async () => {
      const [fit, setFit] = createSignal<'extend' | 'contain'>('extend');
      resize(1280, 960);
      await mount(() => (
        <Screen
          ref={column}
          padding={0}
          designSize={{ width: 1920, height: 1080 }}
          fit={fit()}
        />
      ));
      // 1280/1920 is the smaller ratio: the design space grows to 1920x1440.
      v.expect(column.scale).toBeCloseTo(2 / 3);
      v.expect([column.width, column.height]).toEqual([1920, 1440]);
      v.expect([column.x, column.y]).toEqual([-320, -240]);
      setFit('contain');
      v.expect([column.width, column.height]).toEqual([1920, 1080]);
      v.expect([column.x, column.y]).toEqual([-320, -60]);
      // Set when the viewport changes, and only then.
      resize(960, 540);
      v.expect(column.scale).toBe(0.5);
      v.expect([column.x, column.y]).toEqual([-480, -270]);
      v.expect([column.parent!.width, column.parent!.height]).toEqual([
        960, 540,
      ]);
    },
  );

  v.test('a pointer reaches what is drawn on a scaled Screen', async () => {
    resize(960, 540);
    const pressed = v.vi.fn();
    let pointer!: ReturnType<typeof createScenePointer>;
    await mount(() => {
      pointer = createScenePointer(lng.rootNode);
      return (
        <Screen
          ref={column}
          padding={0}
          designSize={{ width: 1920, height: 1080 }}
        >
          <view width={200} height={100} onEnter={pressed} />
        </Screen>
      );
    });
    const click = (x: number, y: number) => {
      pointer.down(1, { x, y });
      pointer.up(1, { x, y });
    };
    // Drawn at half size: 100 by 50 at the top left of the viewport.
    click(150, 25);
    click(50, 75);
    await settle();
    v.expect(pressed).not.toHaveBeenCalled();
    click(50, 25);
    await settle();
    v.expect(pressed).toHaveBeenCalledTimes(1);
    pointer.dispose();
  });

  v.test('takes the design size from the project settings', async () => {
    resize(960, 540);
    await mount(
      () => <Screen ref={column} />,
      {},
      {
        designSize: { width: 1920, height: 1080 },
      },
    );
    v.expect(column.scale).toBe(0.5);
    // The default padding, in design units.
    v.expect(column.width).toBe(1920 - 2 * 32);
  });
});

v.describe('Text', () => {
  v.test(
    'takes size and colour from the theme and is skipped by focus',
    async () => {
      const theme = defineTheme({
        typography: { title: 40 },
        colors: { text: 0x112233ff },
      });
      await mount(
        () => (
          <Screen ref={column}>
            <Text size="title">Title</Text>
            <Text>Body</Text>
            <Text size={17} muted>
              Small
            </Text>
          </Screen>
        ),
        {},
        { theme },
      );
      const [title, body, small] = column.children as lng.ElementNode[];
      v.expect([title!.fontSize, title!.color]).toEqual([40, 0x112233ff]);
      v.expect(body!.fontSize).toBe(theme.typography.body);
      v.expect([small!.fontSize, small!.color]).toEqual([
        17,
        theme.colors.textMuted,
      ]);
      v.expect(title!.skipFocus).toBe(true);
      v.expect(useThemeOutside().colors.text).not.toBe(0x112233ff);
    },
  );
});
const useThemeOutside = () => createRoot(() => useTheme());

v.describe('Button and List', () => {
  v.test(
    'Enter presses the focused button; down skips text and a disabled button',
    async () => {
      const pressed: string[] = [];
      await mount(() => (
        <Screen>
          <Text>Heading</Text>
          <Button onPress={() => pressed.push('one')}>One</Button>
          <Button onPress={() => pressed.push('off')} disabled>
            Off
          </Button>
          <Button onPress={() => pressed.push('two')}>Two</Button>
        </Screen>
      ));
      await press('Enter');
      await press('ArrowDown');
      await press('Enter');
      v.expect(pressed).toEqual(['one', 'two']);
    },
  );

  v.test(
    'a button is sized by its label and padding, and is a button to assistive technology',
    async () => {
      await mount(() => (
        <Screen ref={column} padding={0}>
          <Button onPress={() => {}}>Play</Button>
        </Screen>
      ));
      const button = column.children[0] as lng.ElementNode;
      const label = button.children[0] as lng.ElementNode;
      // What a drawing backend reports once the text is measured.
      label.width = 60;
      label.height = 30;
      button.updateLayout();
      const theme = defineTheme({});
      v.expect([label.x, label.y]).toEqual([
        theme.spacing(6),
        theme.spacing(3),
      ]);
      v.expect([button.width, button.height]).toEqual([
        60 + 2 * theme.spacing(6),
        Math.round(theme.typography.body * 1.25) + 2 * theme.spacing(3),
      ]);
      v.expect(sceneSemantics(button)[0]).toMatchObject({
        role: 'button',
        label: 'Play',
      });
      v.expect(button.states.has('$focus')).toBe(true);
    },
  );

  v.test(
    'List moves focus through its items and reports the one selected',
    async () => {
      const selected: Array<[string, number]> = [];
      const pressed: string[] = [];
      await mount(() => (
        <Screen>
          <List
            each={['a', 'b', 'c']}
            onSelect={(item, index) => selected.push([item, index])}
          >
            {(item) => (
              <Button onPress={() => pressed.push(item)}>{item}</Button>
            )}
          </List>
        </Screen>
      ));
      await press('ArrowDown');
      await press('Enter');
      await press('ArrowDown');
      await press('Enter');
      v.expect(selected).toEqual([
        ['b', 1],
        ['c', 2],
      ]);
      // The item's own handler still runs.
      v.expect(pressed).toEqual(['b', 'c']);
    },
  );

  v.test('a row List moves with left and right', async () => {
    const selected: string[] = [];
    await mount(() => (
      <Screen>
        <List
          direction="row"
          each={['a', 'b']}
          onSelect={(item) => selected.push(item)}
        >
          {(item) => <Button>{item}</Button>}
        </List>
      </Screen>
    ));
    await press('ArrowRight');
    await press('Enter');
    await press('ArrowLeft');
    await press('Enter');
    v.expect(selected).toEqual(['b', 'a']);
  });
});

v.describe('hooks', () => {
  v.test(
    'useHost, usePlugin and usePlugins read what the entry provides',
    async () => {
      let seen: unknown[] = [];
      const plugin = { run: () => 'ran' };
      await mount(
        () => {
          const host = useHost();
          seen = [
            host.target,
            host.native,
            host.capabilities.inputs.length > 0,
            usePlugin<typeof plugin>('greeting')?.run(),
            usePlugin('absent'),
            Object.keys(usePlugins()),
            useViewport().width,
            useTheme().colorScheme,
            typeof useLocale()(),
            useColorScheme()(),
          ];
          return <Screen />;
        },
        { greeting: plugin },
        { theme: 'dark' },
      );
      v.expect(seen).toEqual([
        'android-tv',
        'view',
        true,
        'ran',
        undefined,
        ['greeting'],
        1920,
        'dark',
        'string',
        'light',
      ]);
    },
  );

  v.test(
    'service hooks follow the service while mounted and are undefined without it',
    async () => {
      let listener: ((online: boolean) => void) | undefined;
      let batteryListener:
        | ((state: { level: number; charging: boolean }) => void)
        | undefined;
      let stopped = 0;
      let batteryStopped = 0;
      const uninstall = installServices({
        connectivity: {
          online: () => false,
          subscribe(next) {
            listener = next;
            return () => stopped++;
          },
        },
        battery: {
          get: () => Promise.resolve({ level: 0.5, charging: true }),
          subscribe(next) {
            batteryListener = next;
            return () => batteryStopped++;
          },
        },
      });
      let online!: () => boolean | undefined;
      let battery!: ReturnType<typeof useBattery>;
      let missing!: ReturnType<typeof useLifecycle>;
      await mount(() => {
        online = useConnectivity();
        battery = useBattery();
        // Nothing provides this one: undefined, and no throw.
        missing = (useLifecycleOf as () => typeof missing)();
        return <Screen />;
      });
      v.expect(online()).toBe(false);
      listener!(true);
      v.expect(online()).toBe(true);
      v.expect(battery()).toEqual({ level: 0.5, charging: true });
      // A provider that reports changes keeps the hook current while mounted.
      batteryListener!({ level: 0.2, charging: false });
      v.expect(battery()).toEqual({ level: 0.2, charging: false });
      v.expect(missing()).toBe(undefined);
      v.expect(available('battery')).toBe(true);
      dispose!();
      dispose = undefined;
      v.expect(stopped).toBe(1);
      v.expect(batteryStopped).toBe(1);
      uninstall();
    },
  );
});

/** `useLifecycle` with the lifecycle service hidden, as on a host without one. */
function useLifecycleOf() {
  const hide = installServices({
    lifecycle: () => {
      throw new Error('no lifecycle on this host');
    },
  });
  try {
    return useLifecycle();
  } finally {
    hide();
  }
}
