/**
 * Contract tests: every overlay surface has a real entrance and exit.
 *
 * Each surface runs once with motion off — that run is both the
 * reduced-motion contract and the oracle that pins the static layout — and
 * once animated, checking the four points the motion family owes: a
 * mid-transition frame differs from the resting one, the entrance ends
 * exactly at the static layout, the exit defers the unmount until it has
 * finished, and reduced motion skips straight to rest.
 */
import * as v from 'vitest';
import { createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import {
  ActionSheet,
  Alert,
  Drawer,
  Menu,
  Modal,
  Popover,
  Sheet,
  Toast,
  Tooltip,
  borderBox,
} from '@solid-multiplatform/platform/primitives';
import { resetCapabilities, setCapabilities } from '../src/sdk/capabilities.js';
import { createScenePointer } from '../src/sdk/input.js';
import { viewport } from '../src/sdk/viewport.js';
import { mount } from './contract-focus-helpers.js';
import { renderer, waitForUpdate } from './setup.js';

/** The renderer node behind an element, as the DOM renderer makes it. */
const dom = (el: lng.ElementNode) =>
  el.lng as unknown as {
    alpha: number;
    scale: number;
    x: number;
    y: number;
    color: number;
    pivotX: number;
    pivotY: number;
    destroyed: boolean;
  };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Under jsdom the DOM renderer's animations finish a few hundred ms late.
const ANIMATION_WAIT = { timeout: 3000 };

/** Waits until the condition holds; animations land within this window. */
const lands = (check: () => void, options = ANIMATION_WAIT) =>
  v.vi.waitFor(check, options);

const findAll = (
  node: unknown,
  predicate: (node: lng.ElementNode) => boolean,
  found: lng.ElementNode[] = [],
): lng.ElementNode[] => {
  if (!lng.isINode(node)) return found;
  if (lng.isElementNode(node) && predicate(node)) found.push(node);
  for (const child of node.children) findAll(child, predicate, found);
  return found;
};

const find = (predicate: (node: lng.ElementNode) => boolean) =>
  findAll(renderer.rootNode, predicate)[0]!;

/** Runs `body` with `Config.animationsEnabled` forced to `value`. */
async function withAnimations(
  value: boolean,
  body: () => Promise<void> | void,
): Promise<void> {
  const before = lng.Config.animationsEnabled;
  lng.Config.animationsEnabled = value;
  try {
    await body();
  } finally {
    lng.Config.animationsEnabled = before;
  }
}

/** The resting geometry a surface must enter and exit against. */
const resting = (el: lng.ElementNode) => {
  const node = dom(el);
  return { alpha: node.alpha, scale: node.scale, x: node.x, y: node.y };
};

v.afterEach(() => resetCapabilities());

v.describe('Modal', () => {
  let panel: lng.ElementNode | undefined;
  const app = (open: () => boolean) => (
    <Modal visible={open} label="Details">
      <view
        ref={(node) => (panel = node as lng.ElementNode)}
        width={480}
        height={260}
      />
    </Modal>
  );

  v.it('dims in, scales the surface up, and reverses both out', async () => {
    // Reduced motion rests at once, and pins the static layout.
    const [open, setOpen] = createSignal(true);
    await withAnimations(false, async () => {
      const dispose = renderer.render(() => app(open()));
      await waitForUpdate();
      const surface = dom(panel!.parent as lng.ElementNode);
      const barrier = dom(
        findAll(renderer.rootNode, (node) => node.role === 'dialog')[0]!,
      );
      v.expect(surface.alpha).toBe(1);
      v.expect(surface.scale).toBe(1);
      v.expect(barrier.color).toBe(0x000000cc);
      dispose();
      setOpen(false);
    });

    const [shown, setShown] = createSignal(true);
    const dispose = renderer.render(() => app(shown));
    await waitForUpdate();
    // Captured now: the overlay leaves the element tree at close time, and
    // keeps painting only through its renderer node.
    const surface = panel!.parent as lng.ElementNode;
    const barrier = find((node) => node.role === 'dialog');
    // Mid-transition: the surface is on its way in, the dim with it.
    v.expect(dom(surface).alpha).toBeLessThan(1);
    v.expect(dom(surface).scale).toBeLessThan(1);
    v.expect(dom(barrier).color).toBeLessThan(0x000000cc);
    // The entrance ends exactly at the static layout.
    await lands(() => {
      v.expect(dom(surface).scale).toBe(1);
    });
    v.expect(resting(surface)).toEqual({
      alpha: 1,
      scale: 1,
      x: 0,
      y: 0,
    });
    v.expect(dom(barrier).color).toBe(0x000000cc);

    // The exit runs before the unmount: the dialog is still on screen while
    // both fade back out, and only then does the node go away.
    setShown(false);
    await sleep(0);
    v.expect(dom(barrier).destroyed).toBe(false);
    await lands(() => {
      v.expect(dom(surface).alpha).toBeLessThan(1);
      v.expect(dom(barrier).color).toBeLessThan(0x000000cc);
    });
    await lands(() => {
      v.expect(dom(barrier).destroyed).toBe(true);
    });
    dispose();
  });
});

v.describe('Alert', () => {
  const app = (open: () => boolean) => (
    <Alert
      visible={open}
      title="Delete this playlist?"
      message="This cannot be undone."
      destructive
      confirmLabel="Delete"
    />
  );

  v.it('fades and scales about its centre, and reverses out', async () => {
    const [open, setOpen] = createSignal(true);
    let rest: ReturnType<typeof resting> | undefined;
    await withAnimations(false, async () => {
      const dispose = renderer.render(() => app(open()));
      await waitForUpdate();
      rest = resting(find((node) => node.id === 'alert-panel'));
      v.expect(rest).toMatchObject({ alpha: 1, scale: 1 });
      dispose();
      setOpen(false);
    });

    const [shown, setShown] = createSignal(true);
    const dispose = renderer.render(() => app(shown));
    await waitForUpdate();
    const panel = find((node) => node.id === 'alert-panel');
    // Mid-transition: fading and scaling in, and never displaced — the panel
    // scales about its own centre, so its position is the resting one.
    v.expect(dom(panel).alpha).toBeLessThan(1);
    v.expect(dom(panel).scale).toBeLessThan(1);
    v.expect(dom(panel).x).toBe(rest!.x);
    v.expect(dom(panel).y).toBe(rest!.y);
    await lands(() => {
      v.expect(dom(panel).scale).toBe(1);
    });
    v.expect(resting(panel)).toEqual(rest!);

    setShown(false);
    await sleep(0);
    v.expect(dom(panel).destroyed).toBe(false);
    await lands(() => {
      v.expect(dom(panel).alpha).toBeLessThan(1);
    });
    await lands(() => {
      v.expect(dom(panel).destroyed).toBe(true);
    });
    dispose();
  });
});

v.describe('ActionSheet', () => {
  const app = (open: () => boolean) => (
    <ActionSheet
      visible={open}
      title="Track actions"
      actions={[
        { label: 'Play next' },
        { label: 'Delete', style: 'destructive' },
      ]}
    />
  );
  // The card is the column that holds the Cancel action.
  const card = () =>
    find((node) => node.ariaLabel === 'Cancel')!.parent as lng.ElementNode;

  v.it(
    'fades and scales the card about its centre, and reverses out',
    async () => {
      const [open, setOpen] = createSignal(true);
      let rest: ReturnType<typeof resting> | undefined;
      await withAnimations(false, async () => {
        const dispose = renderer.render(() => app(open()));
        await waitForUpdate();
        rest = resting(card());
        v.expect(rest).toMatchObject({ alpha: 1, scale: 1 });
        dispose();
        setOpen(false);
      });

      const [shown, setShown] = createSignal(true);
      const dispose = renderer.render(() => app(shown));
      await waitForUpdate();
      const panel = card();
      v.expect(dom(panel).alpha).toBeLessThan(1);
      v.expect(dom(panel).scale).toBeLessThan(1);
      v.expect(dom(panel).x).toBe(rest!.x);
      v.expect(dom(panel).y).toBe(rest!.y);
      await lands(() => {
        v.expect(dom(panel).scale).toBe(1);
      });
      v.expect(resting(panel)).toEqual(rest!);

      setShown(false);
      await sleep(0);
      v.expect(dom(panel).destroyed).toBe(false);
      await lands(() => {
        v.expect(dom(panel).alpha).toBeLessThan(1);
      });
      await lands(() => {
        v.expect(dom(panel).destroyed).toBe(true);
      });
      dispose();
    },
  );
});

v.describe('Sheet', () => {
  const app = (open: () => boolean) => (
    <Sheet visible={open} label="Share" title="Share this playlist">
      <view width={280} height={40} />
    </Sheet>
  );
  const panel = () => find((node) => node.id === 'sheet-panel');

  v.it(
    'slides in from its resting edge, lands at rest, slides back out',
    async () => {
      const [open, setOpen] = createSignal(true);
      let rest: ReturnType<typeof resting> | undefined;
      await withAnimations(false, async () => {
        const dispose = renderer.render(() => app(open()));
        await waitForUpdate();
        rest = resting(panel());
        v.expect(rest).toMatchObject({ alpha: 1, scale: 1 });
        dispose();
        setOpen(false);
      });

      const [shown, setShown] = createSignal(true);
      const dispose = renderer.render(() => app(shown));
      await waitForUpdate();
      const node = panel();
      // Mid-transition: still travelling up from the bottom edge, and — the
      // point of the entrance's fade delay — "not there yet" to the audit.
      v.expect(dom(node).alpha).toBeLessThan(1);
      v.expect(dom(node).y).toBeGreaterThan(rest!.y);
      await lands(() => {
        v.expect(resting(node)).toEqual(rest!);
      });

      // The dismiss slides the panel back off the edge before unmounting.
      setShown(false);
      await sleep(0);
      v.expect(dom(node).destroyed).toBe(false);
      await lands(() => {
        v.expect(dom(node).y).toBeGreaterThan(rest!.y);
      });
      await lands(() => {
        v.expect(dom(node).destroyed).toBe(true);
      });
      dispose();
    },
  );

  v.it(
    'a drag past the threshold dismisses from wherever the finger left it',
    async () => {
      setCapabilities('ios');
      const [open, setOpen] = createSignal(true);
      const dispose = renderer.render(() => (
        <Sheet
          visible={open}
          label="Share"
          title="Share this playlist"
          onRequestClose={() => setOpen(false)}
        >
          <view width={280} height={40} />
        </Sheet>
      ));
      await waitForUpdate();
      const node = panel();

      // Let the entrance land: only then is the panel where the finger can
      // find it, and only that position is the resting one.
      await lands(() => {
        v.expect(dom(node).alpha).toBe(1);
      });
      const rest = dom(node).y;
      const pointer = createScenePointer(lng.rootNode);
      const pull = 300;
      const at = { x: 960, y: Math.round(rest) + 10 };
      pointer.down(1, at);
      pointer.move(1, { x: at.x, y: at.y + pull });
      pointer.up(1, { x: at.x, y: at.y + pull });

      // The close fired mid-drag: the panel is where the finger left it, and
      // it continues from there — neither back at rest nor already gone.
      await sleep(0);
      v.expect(open()).toBe(false);
      v.expect(dom(node).destroyed).toBe(false);
      v.expect(dom(node).y).toBe(rest + pull);
      await lands(() => {
        v.expect(dom(node).destroyed).toBe(true);
      });
      pointer.dispose();
      dispose();
    },
  );
});

v.describe('Drawer', () => {
  const app = (open: () => boolean, side?: 'start' | 'end') => (
    <Drawer visible={open} label="Navigation" side={side}>
      <view width={200} height={40} />
    </Drawer>
  );
  const panel = () =>
    find((node) => node.width === 360 && node.height === viewport().height);

  v.it('slides in from its edge, lands at rest, slides back out', async () => {
    const [open, setOpen] = createSignal(true);
    let rest: ReturnType<typeof resting> | undefined;
    await withAnimations(false, async () => {
      const dispose = renderer.render(() => app(open()));
      await waitForUpdate();
      rest = resting(panel());
      v.expect(rest).toMatchObject({ alpha: 1, scale: 1, x: 0 });
      dispose();
      setOpen(false);
    });

    const [shown, setShown] = createSignal(true);
    const dispose = renderer.render(() => app(shown));
    await waitForUpdate();
    const node = panel();
    // Mid-transition: fully off the leading edge, still travelling in, and
    // "not there yet" to the audit while it does.
    v.expect(dom(node).alpha).toBeLessThan(1);
    v.expect(dom(node).x).toBeLessThan(0);
    await lands(() => {
      v.expect(resting(node)).toEqual(rest!);
    });

    setShown(false);
    await sleep(0);
    v.expect(dom(node).destroyed).toBe(false);
    await lands(() => {
      v.expect(dom(node).x).toBeLessThan(0);
    });
    await lands(() => {
      v.expect(dom(node).destroyed).toBe(true);
    });
    dispose();
  });

  v.it('the end side slides from the trailing edge', async () => {
    const [shown, setShown] = createSignal(true);
    const dispose = renderer.render(() => app(shown, 'end'));
    await waitForUpdate();
    const node = panel();
    const edge = viewport().width - 360;
    // Mid-transition: off the trailing edge, on its way in.
    v.expect(dom(node).alpha).toBeLessThan(1);
    v.expect(dom(node).x).toBeGreaterThan(edge);
    await lands(() => {
      v.expect(dom(node).x).toBe(edge);
      v.expect(dom(node).alpha).toBe(1);
    });

    setShown(false);
    await sleep(0);
    v.expect(dom(node).destroyed).toBe(false);
    await lands(() => {
      v.expect(dom(node).destroyed).toBe(true);
    });
    dispose();
  });
});

v.describe('Popover and the menus built on it', () => {
  const anchor = { x: 400, y: 300, width: 120, height: 40 };
  const app = (open: () => boolean) => (
    <Popover visible={open} anchor={anchor} label="Filters">
      <view width={200} height={100} />
    </Popover>
  );
  const panel = () =>
    find(
      (node) =>
        node.width === 280 && node.height === 240 && node.role === 'none',
    );

  v.it('fades and scales about the anchor side, and reverses out', async () => {
    const [open, setOpen] = createSignal(true);
    let rest: ReturnType<typeof resting> | undefined;
    await withAnimations(false, async () => {
      const dispose = renderer.render(() => app(open()));
      await waitForUpdate();
      rest = resting(panel());
      v.expect(rest).toMatchObject({ alpha: 1, scale: 1 });
      v.expect(dom(panel()).pivotX).toBe(0.5);
      // Placed below the anchor: the edge that faces the anchor is the top
      // one, so the scale grows out of the anchor.
      v.expect(dom(panel()).pivotY).toBe(0);
      dispose();
      setOpen(false);
    });

    const [shown, setShown] = createSignal(true);
    const dispose = renderer.render(() => app(shown));
    await waitForUpdate();
    const node = panel();
    v.expect(dom(node).alpha).toBeLessThan(1);
    v.expect(dom(node).scale).toBeLessThan(1);
    // The panel never travels: only its scale and alpha move.
    v.expect(dom(node).x).toBe(rest!.x);
    v.expect(dom(node).y).toBe(rest!.y);
    await lands(() => {
      v.expect(dom(node).scale).toBe(1);
    });
    v.expect(resting(node)).toEqual(rest!);

    setShown(false);
    await sleep(0);
    v.expect(dom(node).destroyed).toBe(false);
    await lands(() => {
      v.expect(dom(node).alpha).toBeLessThan(1);
    });
    await lands(() => {
      v.expect(dom(node).destroyed).toBe(true);
    });
    dispose();
  });

  v.it('a Menu inherits the anchored entrance and exit', async () => {
    const [open, setOpen] = createSignal(true);
    const dispose = renderer.render(() => (
      <Menu
        visible={open}
        anchor={anchor}
        items={[{ label: 'One' }, { label: 'Two' }]}
        onRequestClose={() => setOpen(false)}
      />
    ));
    await waitForUpdate();
    const menu = find((node) => node.role === 'menu');
    v.expect(dom(menu).alpha).toBeLessThan(1);
    v.expect(dom(menu).scale).toBeLessThan(1);
    await lands(() => {
      v.expect(dom(menu).scale).toBe(1);
    });

    setOpen(false);
    await sleep(0);
    v.expect(dom(menu).destroyed).toBe(false);
    await lands(() => {
      v.expect(dom(menu).alpha).toBeLessThan(1);
    });
    await lands(() => {
      v.expect(dom(menu).destroyed).toBe(true);
    });
    dispose();
  });
});

v.describe('Tooltip', () => {
  const anchor = { x: 100, y: 100, width: 300, height: 38 };
  const app = (open: () => boolean) => (
    <Tooltip visible={open} anchor={anchor} label="Hint" />
  );
  const panel = () => find((node) => node.role === 'tooltip');

  v.it('fades and scales about the anchor side, and reverses out', async () => {
    const [open, setOpen] = createSignal(true);
    let rest: ReturnType<typeof resting> | undefined;
    await withAnimations(false, async () => {
      const dispose = renderer.render(() => app(open()));
      await waitForUpdate();
      rest = resting(panel());
      v.expect(rest).toMatchObject({ alpha: 1, scale: 1 });
      // Placed above the anchor: the facing edge is the bottom one.
      v.expect(dom(panel()).pivotY).toBe(1);
      dispose();
      setOpen(false);
    });

    const [shown, setShown] = createSignal(true);
    const dispose = renderer.render(() => app(shown));
    await waitForUpdate();
    const node = panel();
    v.expect(dom(node).alpha).toBeLessThan(1);
    v.expect(dom(node).scale).toBeLessThan(1);
    await lands(() => {
      v.expect(dom(node).scale).toBe(1);
    });
    v.expect(resting(node)).toEqual(rest!);

    setShown(false);
    await sleep(0);
    v.expect(dom(node).destroyed).toBe(false);
    await lands(() => {
      v.expect(dom(node).alpha).toBeLessThan(1);
    });
    await lands(() => {
      v.expect(dom(node).destroyed).toBe(true);
    });
    dispose();
  });
});

v.describe('Toast', () => {
  const app = (open: () => boolean) => (
    <Toast visible={open} message="Saved" duration={0} />
  );
  const panel = () => find((node) => node.role === 'status');

  v.it('fades in and out in place, never scaling or moving', async () => {
    const [open, setOpen] = createSignal(true);
    let rest: ReturnType<typeof resting> | undefined;
    await withAnimations(false, async () => {
      const dispose = renderer.render(() => app(open()));
      await waitForUpdate();
      rest = resting(panel());
      v.expect(rest).toMatchObject({ alpha: 1, scale: 1 });
      dispose();
      setOpen(false);
    });

    const [shown, setShown] = createSignal(true);
    const dispose = renderer.render(() => app(shown));
    await waitForUpdate();
    const node = panel();
    v.expect(dom(node).alpha).toBeLessThan(1);
    // A status message appears where it rests: no scale, no travel.
    v.expect(dom(node).scale).toBe(1);
    v.expect(dom(node).x).toBe(rest!.x);
    v.expect(dom(node).y).toBe(rest!.y);
    await lands(() => {
      v.expect(dom(node).alpha).toBe(1);
    });
    v.expect(resting(node)).toEqual(rest!);

    setShown(false);
    await sleep(0);
    v.expect(dom(node).destroyed).toBe(false);
    await lands(() => {
      v.expect(dom(node).alpha).toBeLessThan(1);
    });
    await lands(() => {
      v.expect(dom(node).destroyed).toBe(true);
    });
    dispose();
  });
});

v.describe('borderBox', () => {
  // The directive as it would be attached by `use:borderBox`, called from
  // the ref: the same (element, accessor) contract, without depending on
  // the JSX directive transform in a test file.
  const bordered = (ref: (node: lng.ElementNode) => void) => (
    <view
      ref={(node) => {
        borderBox(node, () => true);
        ref(node as lng.ElementNode);
      }}
      width={200}
      height={60}
      autofocus
      onEnter={() => true}
    />
  );
  const scene = () => (
    <view width={400} height={200}>
      {bordered((node) => (ring = node as lng.ElementNode))}
      <view
        ref={(node) => (away = node as lng.ElementNode)}
        x={240}
        width={100}
        height={40}
        onEnter={() => true}
      />
    </view>
  );
  let ring!: lng.ElementNode;
  let away!: lng.ElementNode;

  /** The focus ring box hanging under the bordered view. */
  const box = () =>
    ring.children.find(lng.isElementNode) as lng.ElementNode | undefined;

  v.it('refocus during the fade-out reuses the dying box', async () => {
    const { dispose } = await mount(scene);
    const first = box()!;
    await lands(() => {
      v.expect(dom(first).alpha).toBe(1);
    });

    // Blur: the box starts fading out. Refocus inside the 100 ms window.
    away.setFocus();
    await lands(
      () => {
        v.expect(dom(first).alpha).toBeLessThan(1);
      },
      { timeout: 500, interval: 10 },
    );
    ring.setFocus();
    // The same box comes back: no second box was mounted beside it.
    v.expect(box()).toBe(first);
    await lands(() => {
      v.expect(dom(first).alpha).toBe(1);
    });
    v.expect(dom(first).destroyed).toBe(false);

    // A blur that completes takes the box down for good.
    away.setFocus();
    await lands(() => {
      v.expect(dom(first).destroyed).toBe(true);
    });
    v.expect(box()).toBeUndefined();
    dispose();
  });

  v.it('reduced motion shows and hides the box at once', async () => {
    const { dispose } = await mount(scene);
    await withAnimations(false, async () => {
      // The mount's own box was still entering: take it down (motion off,
      // so at once), then check a box created while motion is off.
      away.setFocus();
      await sleep(0);
      v.expect(box()).toBeUndefined();

      ring.setFocus();
      // Focus (and the onFocusChanged that mounts the box) applies in the
      // post-mutation pass, not synchronously.
      await sleep(0);
      const shown = box()!;
      // Shown instantly: no fade, no lingering at an intermediate alpha.
      v.expect(dom(shown).alpha).toBe(1);
      // Hidden instantly: nothing lingers after the blur.
      away.setFocus();
      await sleep(0);
      v.expect(dom(shown).destroyed).toBe(true);
      v.expect(box()).toBeUndefined();
    });
    dispose();
  });
});
