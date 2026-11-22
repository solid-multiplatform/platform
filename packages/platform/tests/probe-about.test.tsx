// Scratch probe: open the About dialog at every audit size and print geometry.
// Two passes, as a device does it: first the fallback estimate (the font
// description has not arrived), then a re-measure once the face registers.
import { writeFileSync } from 'node:fs';
import * as v from 'vitest';
import * as lng from '@solid-multiplatform/platform';
import { App } from '../../../apps/gallery/src/App';
import { renderer, waitForUpdate } from './setup.js';
import { setCapabilities } from '../src/sdk/capabilities.js';
import { updateViewport, zeroInsets } from '../src/sdk/viewport.js';

interface Profile {
  name: string;
  width: number;
  height: number;
  target: 'web' | 'android-tv' | 'roku';
  safeArea?: { top: number; right: number; bottom: number; left: number };
}

const PROFILES: Profile[] = [
  {
    name: 'Pixel 7 Pro',
    width: 412,
    height: 892,
    target: 'web',
    safeArea: { top: 24, right: 0, bottom: 16, left: 0 },
  },
  {
    name: 'phone 390x844',
    width: 390,
    height: 844,
    target: 'web',
    safeArea: { top: 24, right: 0, bottom: 16, left: 0 },
  },
  { name: 'phone SE', width: 320, height: 568, target: 'web' },
  { name: 'Android TV', width: 960, height: 540, target: 'android-tv' },
  { name: 'Roku', width: 1920, height: 1080, target: 'roku' },
  { name: 'desktop', width: 1440, height: 900, target: 'web' },
];

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

function resize(profile: Profile) {
  updateViewport(
    {
      width: profile.width,
      height: profile.height,
      scale: 1,
      safeArea: profile.safeArea ?? zeroInsets,
      keyboardInset: 0,
      reducedMotion: false,
    },
    null,
  );
}

const texts = (node: unknown): string[] => {
  const current = node as { text?: string; children?: readonly unknown[] };
  if (typeof current.text === 'string') return [current.text];
  return (current.children ?? []).flatMap((child) => texts(child));
};

function findAll(
  node: unknown,
  predicate: (node: lng.ElementNode) => boolean,
  found: lng.ElementNode[] = [],
): lng.ElementNode[] {
  if (node === undefined || node === null) return found;
  if (!lng.isINode(node)) return found;
  if (lng.isElementNode(node) && predicate(node)) found.push(node);
  for (const child of node.children) findAll(child, predicate, found);
  return found;
}

const box = (node: lng.ElementNode | undefined): string =>
  node === undefined
    ? 'undefined'
    : `abs ${Math.round(node.absX ?? 0)},${Math.round(node.absY ?? 0)} size ${Math.round(node.width)}x${Math.round(node.height)}`;

v.test('probe about dialog geometry', async () => {
  let releaseFonts: (() => void) | undefined;
  const fontsReady = new Promise<void>((resolve) => {
    releaseFonts = resolve;
  });
  (document as unknown as { fonts: unknown }).fonts = { ready: fontsReady };
  for (const profile of PROFILES) {
    setCapabilities(profile.target);
    resize(profile);
    const before = lng.rootNode.children.slice();
    const dispose = renderer.render(() => <App />);
    await waitForUpdate();
    await settle();
    const nav = findAll(lng.rootNode, (node) => node.ariaLabel === 'Settings')[0];
    nav?.onMouseClick?.(new MouseEvent('click'), nav);
    await waitForUpdate();
    await settle();
    const about = findAll(
      lng.rootNode,
      (node) =>
        typeof node.onMouseClick === 'function' &&
        texts(node).some((text) => text.includes('About Sona')),
    )[0];
    about?.onMouseClick?.(new MouseEvent('click'), about);
    await waitForUpdate();
    await settle();

    const dialog = findAll(
      lng.rootNode,
      (node) => node.role === 'dialog' && node.ariaLabel === 'About Sona',
    )[0];
    const panelOf = () =>
      dialog?.children[0]?.children[0] as lng.ElementNode | undefined;
    const write = (lines: string[]) =>
      writeFileSync('/var/tmp/probe-about.txt', lines.join('\n') + '\n', {
        flag: 'a',
      });
    const dumpAt = (tag: string) => {
      const panel = panelOf();
      const markdown = panel?.children[0] as lng.ElementNode | undefined;
      const closeRow = panel?.children[1] as lng.ElementNode | undefined;
      const closeButton = findAll(
        panel,
        (node) => texts(node).some((text) => text === 'Close'),
      ).at(-1);
      const lines = [
        `[${tag}] panel ${box(panel)} markdown ${box(markdown)}`,
        `[${tag}] closeRow ${box(closeRow)} closeButton ${box(closeButton)}`,
      ];
      const result = lng.auditLayout(
        lng.rootNode,
        { x: 0, y: 0, width: profile.width, height: profile.height },
        { tolerance: 1 },
      );
      for (const finding of result.findings)
        lines.push(`[${tag}] FINDING: ` + lng.formatLayoutFinding(finding));
      if (result.findings.length === 0) lines.push(`[${tag}] no findings`);
      write(lines);
    };
    write([`\n=== ${profile.name} (${profile.width}x${profile.height})`]);
    dumpAt('first pass, fallback estimate');

    // The app's face registers: the renderer can measure, wider per glyph than
    // the 0.55em fallback estimate (a real face at 16px runs ~0.6em+).
    const scene = lng.getRenderer() as unknown as {
      measureText?: (props: {
        text: string;
        fontSize?: number;
      }) => { w: number } | null;
    };
    scene.measureText = (props) => ({
      w: props.text.length * (props.fontSize ?? 24) * 0.62,
    });
    const beforeHeight = (() => {
      const panel = panelOf();
      const markdown = panel?.children[0] as lng.ElementNode | undefined;
      return markdown?.height ?? 0;
    })();
    releaseFonts?.();
    let landed = false;
    for (let i = 0; i < 40 && !landed; i++) {
      await settle();
      const panel = panelOf();
      const markdown = panel?.children[0] as lng.ElementNode | undefined;
      landed =
        (markdown?.height ?? 0) !== beforeHeight && (markdown?.height ?? 0) > 0;
    }
    write([`[re-measure landed after poll: ${landed}`]);
    dumpAt('second pass, registered face');

    dispose();
    for (const child of lng.rootNode.children.slice()) {
      if (before.indexOf(child) !== -1) continue;
      lng.rootNode.removeChild(child);
      if (lng.isElementNode(child)) child.destroy();
    }
  }
}, 60000);
