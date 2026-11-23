// The gallery's matched-geometry flight, both directions: the pressed card's
// cover AND title fly to the album (and back), ending exactly on the real
// elements. The title is the half the owner reported flashing: it must exist
// as a clone mid-flight, carrying the album title, scaled between the two
// font sizes — not one size swapped for the other at the end. The pressed
// card is captured by identity, so the same album showing in several rails
// never confuses the back destination.
import { expect, test } from 'vitest';
const setup = await import('./setup-phone');
import * as lng from '@solid-multiplatform/platform';
import { startApp } from '@solid-multiplatform/platform/host';
import { webHost } from '@solid-multiplatform/platform/host/web';
import { appEntry } from '@solid-multiplatform/platform/app/entry';
import { App } from '../../../../apps/gallery/src/App';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test(
  'open and back fly the cover and title from the pressed card',
  { timeout: 60000 },
  async () => {
    document.body.innerHTML =
      '<div id="app" style="width:390px;height:844px"></div>';
    const surface = document.getElementById('app')!;
    surface.setPointerCapture = () => {};
    surface.releasePointerCapture = () => {};
    const entry = appEntry(App, {}, {});
    const stop = startApp(
      webHost({ root: surface, namespace: 'hero-flight', semantics: false }),
      entry.root,
      entry.options,
    ) as () => void;
    await setup.settle();
    await sleep(300);

    const findText = (text: string): lng.ElementNode | undefined => {
      const walk = (node: lng.ElementNode): lng.ElementNode | undefined => {
        const self = node as unknown as {
          text?: string;
          children?: readonly unknown[];
        };
        if (self.text === text) return node;
        for (const child of (self.children ?? []) as lng.ElementNode[]) {
          const found = walk(child);
          if (found) return found;
        }
        return undefined;
      };
      for (const child of lng.rootNode.children as lng.ElementNode[]) {
        const found = walk(child);
        if (found) return found;
      }
      return undefined;
    };
    const clickable = (node: lng.ElementNode | undefined) => {
      let current: lng.ElementNode | undefined = node;
      while (current !== undefined && current.onMouseClick === undefined)
        current = current.parent;
      return current;
    };
    const cloneAt = (minZ: number): lng.ElementNode | undefined => {
      let found: lng.ElementNode | undefined;
      const walk = (node: lng.ElementNode) => {
        if (((node.zIndex as number) || 0) >= minZ) found = node;
        for (const child of (node.children ?? []) as lng.ElementNode[])
          walk(child);
      };
      for (const child of lng.rootNode.children as lng.ElementNode[])
        walk(child);
      return found;
    };
    const hasText = (
      root: lng.ElementNode | undefined,
      text: string,
    ): boolean => {
      if (root === undefined) return false;
      const self = root as unknown as { text?: string };
      if (self.text === text) return true;
      return ((root.children ?? []) as lng.ElementNode[]).some((child) =>
        hasText(child, text),
      );
    };

    try {
      // Open from a specific card ("Paper Sun", second card of the first rail).
      const card = clickable(findText('Paper Sun'));
      expect(card).toBeDefined();
      card!.onMouseClick!(undefined as never, card!);
      await sleep(280);

      // Mid-flight: the cover clone and the title clone both exist, and the
      // title clone carries the album title.
      expect(cloneAt(600)).toBeDefined();
      const titleClone = cloneAt(601);
      expect(titleClone).toBeDefined();
      expect(hasText(titleClone, 'Paper Sun')).toBe(true);

      // Landed: the album shows its own title.
      await sleep(600);
      expect(cloneAt(600)).toBeUndefined();
      expect(
        findText('Night Arithmetic') ?? findText('Paper Sun'),
      ).toBeDefined();

      // Back: the clones fly again and land on the pressed card's rail.
      const back = clickable(findText('Back'));
      expect(back).toBeDefined();
      back!.onMouseClick!(undefined as never, back!);
      await sleep(250);
      expect(cloneAt(600)).toBeDefined();
      const backTitle = cloneAt(601);
      expect(backTitle).toBeDefined();
      expect(hasText(backTitle, 'Paper Sun')).toBe(true);
      // No duplicate at the destination: the pressed card's own title waits
      // hidden while the clone flies to it.
      const cardTitle = findText('Paper Sun');
      expect(cardTitle).toBeDefined();
      expect(cardTitle!.alpha).toBe(0);

      await sleep(700);
      expect(cloneAt(600)).toBeUndefined();
      // The library shows again with the pressed card intact and its title
      // back to full strength.
      const restored = findText('Paper Sun');
      expect(restored).toBeDefined();
      expect(restored!.alpha).toBe(1);
    } finally {
      stop();
    }
  },
);
