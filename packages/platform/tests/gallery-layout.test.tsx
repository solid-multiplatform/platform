// The gallery is the framework's own product: audit its real screens at the
// sizes the app ships to. A screenshot can show a clipped column; this reads
// the laid-out boxes and names the node that escapes, so the regression is
// caught without a human looking at pixels.
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
    name: 'phone SE',
    width: 320,
    height: 568,
    target: 'web',
  },
  {
    name: 'Android TV',
    width: 960,
    height: 540,
    target: 'android-tv',
  },
  {
    name: 'Roku',
    width: 1920,
    height: 1080,
    target: 'roku',
  },
  {
    name: 'desktop',
    width: 1440,
    height: 900,
    target: 'web',
  },
];

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

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

function findingsFor(profile: Profile): lng.LayoutFinding[] {
  return lng.auditLayout(
    lng.rootNode,
    { x: 0, y: 0, width: profile.width, height: profile.height },
    { tolerance: 1 },
  ).findings;
}

const texts = (node: unknown): string[] => {
  const current = node as { text?: string; children?: readonly unknown[] };
  if (typeof current.text === 'string') return [current.text];
  return (current.children ?? []).flatMap((child) => texts(child));
};

const describe = (findings: lng.LayoutFinding[]) =>
  findings.map((finding) => lng.formatLayoutFinding(finding)).join('\n');

async function mountApp(profile: Profile): Promise<() => void> {
  setCapabilities(profile.target);
  resize(profile);
  const before = lng.rootNode.children.slice();
  const dispose = renderer.render(() => <App />);
  await waitForUpdate();
  await settle();
  return () => {
    dispose();
    for (const child of lng.rootNode.children.slice()) {
      if (before.indexOf(child) !== -1) continue;
      lng.rootNode.removeChild(child);
      if (lng.isElementNode(child)) child.destroy();
    }
  };
}

/** Click the app's own navigation row, wherever the shell drew it. */
function navigate(label: string) {
  const button = findAll(lng.rootNode, (node) => node.ariaLabel === label)[0];
  button?.onMouseClick?.(new MouseEvent('click'), button);
}

function findAll(
  node: unknown,
  predicate: (node: lng.ElementNode) => boolean,
  found: lng.ElementNode[] = [],
): lng.ElementNode[] {
  if (!lng.isINode(node)) return found;
  if (lng.isElementNode(node) && predicate(node)) found.push(node);
  for (const child of node.children) findAll(child, predicate, found);
  return found;
}

v.describe('gallery layout', () => {
  for (const profile of PROFILES) {
    v.test(`library fits a ${profile.name}`, async () => {
      const dispose = await mountApp(profile);
      try {
        v.expect(texts(lng.rootNode).join('|')).toContain('Recently played');
        const findings = findingsFor(profile);
        v.expect(findings, describe(findings)).toHaveLength(0);
      } finally {
        dispose();
      }
    });

    v.test(`create fits a ${profile.name}`, async () => {
      const dispose = await mountApp(profile);
      try {
        navigate('Create');
        await waitForUpdate();
        await settle();
        v.expect(texts(lng.rootNode).join('|')).toContain('New playlist');
        const findings = findingsFor(profile);
        v.expect(findings, describe(findings)).toHaveLength(0);
      } finally {
        dispose();
      }
    });

    v.test(`settings fits a ${profile.name}`, async () => {
      const dispose = await mountApp(profile);
      try {
        navigate('Settings');
        await waitForUpdate();
        await settle();
        v.expect(texts(lng.rootNode).join('|')).toContain('Dialogs, drawers');
        const findings = findingsFor(profile);
        v.expect(findings, describe(findings)).toHaveLength(0);
      } finally {
        dispose();
      }
    });
  }
});

v.describe('gallery create with the calendar open', () => {
  const profile: Profile = {
    name: 'Pixel 7 Pro',
    width: 412,
    height: 892,
    target: 'web',
    safeArea: { top: 24, right: 0, bottom: 16, left: 0 },
  };

  v.test('the calendar and the form both fit', async () => {
    const dispose = await mountApp(profile);
    try {
      navigate('Create');
      await waitForUpdate();
      await settle();
      // The date row is a button whose label is the current value.
      const dateButton = findAll(
        lng.rootNode,
        (node) =>
          typeof node.onMouseClick === 'function' &&
          texts(node).some((text) => text.includes('2026')),
      ).at(-1);
      v.expect(dateButton).toBeDefined();
      dateButton!.onMouseClick?.(new MouseEvent('click'), dateButton!);
      await waitForUpdate();
      await settle();
      v.expect(texts(lng.rootNode).join('|')).toContain('Release date');
      const findings = findingsFor(profile);
      v.expect(findings, describe(findings)).toHaveLength(0);
    } finally {
      dispose();
    }
  });
});
