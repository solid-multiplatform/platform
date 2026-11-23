// The gallery's overlays, audited OPEN. The mounted-screen audit
// (gallery-layout.test.tsx) never opens a dialog, which is exactly how the
// About dialog shipped with a Close row that could leave its card: the
// geometry only exists while the overlay is open.
//
// The harness drives the app's own controls — the same onClick and
// onPointerContext handlers a finger uses — so the screens need no test-only
// props, no exported setters and no runtime hooks. The rules are the ones the
// runtime audit already applies:
//
// - **cut-off** — no box may leave the viewport (the whole scene is audited
//   while the dialog is open, portal included);
// - **inside the card** — no control may spill out of the panel that painted
//   it (`auditLayout` panel rule, unchanged);
// - **inside the safe area** — a centered dialog's own subtree is audited
//   against the safe content rect. Full-bleed surfaces (a drawer that runs
//   behind the system bars by design) are exempt from this one rule; their
//   content rows position themselves inside the insets already.
//
// Rotated phones are included because a fixed-height dialog dies there first:
// the shortest profile here (568x320) is the honest worst case for any
// "centered card" geometry.
import * as v from 'vitest';
import * as lng from '@solid-multiplatform/platform';
import { Modal } from '@solid-multiplatform/platform/primitives';
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
    // The size the owner's report does its math at: Chrome on a Pixel reports
    // visual-viewport units close to this. Covered alongside 412x892 so both
    // conventions of "Pixel 7 Pro" are audited.
    name: 'phone 390x844',
    width: 390,
    height: 844,
    target: 'web',
    safeArea: { top: 24, right: 0, bottom: 16, left: 0 },
  },
  {
    // A small Android: 320 pt wide with gesture insets.
    name: 'phone small Android',
    width: 320,
    height: 692,
    target: 'web',
    safeArea: { top: 24, right: 0, bottom: 16, left: 0 },
  },
  { name: 'phone SE', width: 320, height: 568, target: 'web' },
  {
    name: 'phone landscape',
    width: 892,
    height: 412,
    target: 'web',
    safeArea: { top: 0, right: 47, bottom: 21, left: 47 },
  },
  {
    // The rotated small phone: the shortest room any dialog has to fit.
    name: 'phone small landscape',
    width: 568,
    height: 320,
    target: 'web',
    safeArea: { top: 0, right: 47, bottom: 21, left: 47 },
  },
  { name: 'Android TV', width: 960, height: 540, target: 'android-tv' },
  { name: 'Roku', width: 1920, height: 1080, target: 'roku' },
  { name: 'desktop', width: 1440, height: 900, target: 'web' },
];

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 12));

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

/** Click the app's own control whose label is `label`, wherever it is. */
function press(label: string) {
  const button = findAll(
    lng.rootNode,
    (node) =>
      typeof node.onMouseClick === 'function' &&
      texts(node).some((text) => text === label),
  )[0];
  button?.onMouseClick?.(new MouseEvent('click'), button);
}

/** Click the app's own control by accessible name (icon buttons). */
function pressLabel(label: string, last = false) {
  const matches = findAll(lng.rootNode, (node) => node.ariaLabel === label);
  const button = last ? matches.at(-1) : matches[0];
  button?.onMouseClick?.(new MouseEvent('click'), button);
}

const describeFindings = (findings: lng.LayoutFinding[]) =>
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

function navigate(label: string) {
  const button = findAll(lng.rootNode, (node) => node.ariaLabel === label)[0];
  button?.onMouseClick?.(new MouseEvent('click'), button);
}

/** The open dialog with this accessible name, or undefined. */
function openDialog(label: string): lng.ElementNode | undefined {
  return findAll(
    lng.rootNode,
    (node) =>
      (node.role === 'dialog' || node.role === 'alertdialog') &&
      node.ariaLabel === label,
  )[0];
}

/** A backdrop tap on the barrier, as a finger outside the card makes. */
function tapBackdrop(label: string) {
  const dialog = openDialog(label);
  dialog?.onMouseClick?.(new MouseEvent('click'), dialog);
}

interface OverlayRules {
  /** The dialog's accessible name while open. */
  label: string;
  /**
   * A drawer runs the full height behind the system bars on purpose: exempt
   * it from the safe-area rule (its rows sit inside the insets already) and
   * hold it to the viewport and panel rules only.
   */
  fullBleed?: boolean;
}

/**
 * Audit the scene while an overlay is open. Returns every finding: the whole
 * scene against the viewport (cut-off), and — for a centered dialog — the
 * dialog's own subtree against the safe content rect.
 */
function auditOverlay(
  profile: Profile,
  rules: OverlayRules,
): lng.LayoutFinding[] {
  const findings = lng.auditLayout(
    lng.rootNode,
    { x: 0, y: 0, width: profile.width, height: profile.height },
    { tolerance: 1 },
  ).findings;
  if (rules.fullBleed === true) return findings;
  const dialog = openDialog(rules.label);
  const inner = dialog?.children[0] as lng.ElementNode | undefined;
  if (inner === undefined) return findings;
  const safe = profile.safeArea ?? zeroInsets;
  // The audit walks in the inner container's coordinate space; translate the
  // safe rect by the container's own offset (zero for the app's overlays).
  const bounds = {
    x: safe.left - (inner.x || 0),
    y: safe.top - (inner.y || 0),
    width: profile.width - safe.left - safe.right,
    height: profile.height - safe.top - safe.bottom,
  };
  return [
    ...findings,
    ...lng.auditLayout(inner, bounds, { tolerance: 1 }).findings,
  ];
}

const expectFits = (profile: Profile, rules: OverlayRules): void => {
  const findings = auditOverlay(profile, rules);
  v.expect(findings, describeFindings(findings)).toHaveLength(0);
};

v.describe('gallery overlays, open', () => {
  for (const profile of PROFILES) {
    v.test(`settings overlays fit a ${profile.name}`, async () => {
      const dispose = await mountApp(profile);
      try {
        navigate('Settings');
        await waitForUpdate();
        await settle();

        press('About Sona');
        await waitForUpdate();
        await settle();
        expectFits(profile, { label: 'About Sona' });
        press('Close');
        await waitForUpdate();
        await settle();

        press('Advanced');
        await waitForUpdate();
        await settle();
        // The drawer is full-bleed by design; the viewport and panel rules
        // still apply (its checkboxes must not leave the drawer's card).
        expectFits(profile, { label: 'Advanced', fullBleed: true });
        press('Close');
        await waitForUpdate();
        await settle();

        press('What is measured?');
        await waitForUpdate();
        await settle();
        expectFits(profile, { label: 'What is measured?' });
        tapBackdrop('What is measured?');
        await waitForUpdate();
        await settle();

        press('Reset library');
        await waitForUpdate();
        await settle();
        expectFits(profile, { label: 'Reset the library?' });
        pressLabel('Cancel');
        await waitForUpdate();
        await settle();
      } finally {
        dispose();
      }
    });

    v.test(`create overlays fit a ${profile.name}`, async () => {
      const dispose = await mountApp(profile);
      try {
        navigate('Create');
        await waitForUpdate();
        await settle();

        // The date row is the control whose label is the current date.
        press('Nov 21, 2026');
        await waitForUpdate();
        await settle();
        expectFits(profile, { label: 'Release date' });
        tapBackdrop('Release date');
        await waitForUpdate();
        await settle();

        // A dirty form cancels through the discard alert.
        press('Carriage Return');
        await waitForUpdate();
        await settle();
        press('Cancel');
        await waitForUpdate();
        await settle();
        expectFits(profile, { label: 'Discard this playlist?' });
        pressLabel('Cancel');
        await waitForUpdate();
        await settle();
      } finally {
        dispose();
      }
    });

    v.test(`album overlays fit a ${profile.name}`, async () => {
      const dispose = await mountApp(profile);
      try {
        // Open the featured album: its card is the click target carrying the
        // title. The hero flight runs 420 ms; let it land before auditing so
        // the clone is gone and only the settled screen is measured.
        press('Night Arithmetic');
        await waitForUpdate();
        await new Promise<void>((resolve) => setTimeout(resolve, 550));

        // The library stays mounted under the album, so the album's More is
        // the last control of that name in the tree.
        pressLabel('More', true);
        await waitForUpdate();
        await settle();
        expectFits(profile, { label: 'Album actions' });
        press('Share');
        await waitForUpdate();
        await settle();

        // A long-press on the cover opens the context menu at the point.
        const cover = findAll(
          lng.rootNode,
          (node) => typeof node.onPointerContext === 'function',
        )[0];
        cover?.onPointerContext?.({ x: 150, y: 250 }, cover);
        await waitForUpdate();
        await settle();
        expectFits(profile, { label: 'Context menu' });
        press('Copy link');
        await waitForUpdate();
        await settle();
      } finally {
        dispose();
      }
    });

    v.test(`the performance overlay fits a ${profile.name}`, async () => {
      const dispose = await mountApp(profile);
      try {
        pressLabel('Expand performance overlay');
        await waitForUpdate();
        await settle();
        const findings = lng.auditLayout(
          lng.rootNode,
          { x: 0, y: 0, width: profile.width, height: profile.height },
          { tolerance: 1 },
        ).findings;
        v.expect(findings, describeFindings(findings)).toHaveLength(0);
      } finally {
        dispose();
      }
    });
  }
});

v.describe('the audit gate catches an overflowing dialog', () => {
  // The red/green proof of the gate itself: a dialog whose action row is
  // placed past its card, and a dialog that ignores the safe area. Both are
  // the shapes the owner's report names; the audit must report each.
  const profile: Profile = {
    name: 'Pixel 7 Pro',
    width: 412,
    height: 892,
    target: 'web',
    safeArea: { top: 24, right: 0, bottom: 16, left: 0 },
  };

  v.test('a control past its dialog is reported', async () => {
    const before = lng.rootNode.children.slice();
    setCapabilities(profile.target);
    resize(profile);
    const dispose = renderer.render(() => (
      <Modal visible label="Broken" useSafeArea={false}>
        <view
          x={46}
          y={300}
          width={320}
          height={120}
          color={0x111114ff}
          borderRadius={14}
        >
          {/* The Close row sits 40 units past the card's bottom edge. */}
          <view
            x={200}
            y={160}
            width={112}
            height={44}
            role="button"
            ariaLabel="Close"
            color={0x222228ff}
            borderRadius={22}
          >
            <text fontSize={13}>Close</text>
          </view>
        </view>
      </Modal>
    ));
    await waitForUpdate();
    await settle();
    try {
      const findings = lng.auditLayout(
        lng.rootNode,
        { x: 0, y: 0, width: profile.width, height: profile.height },
        { tolerance: 1 },
      ).findings;
      const close = findings.filter(
        (finding) => finding.node.ariaLabel === 'Close',
      );
      v.expect(close.length, describeFindings(findings)).toBeGreaterThan(0);
      v.expect(close[0]!.severity).toBe('overflow');
    } finally {
      dispose();
      for (const child of lng.rootNode.children.slice()) {
        if (before.indexOf(child) !== -1) continue;
        lng.rootNode.removeChild(child);
        if (lng.isElementNode(child)) child.destroy();
      }
    }
  });

  v.test('a dialog past the safe area is reported', async () => {
    const before = lng.rootNode.children.slice();
    setCapabilities(profile.target);
    resize(profile);
    const dispose = renderer.render(() => (
      <Modal visible label="Low" useSafeArea={false}>
        {/* 30 units into the gesture bar: on screen, but outside the safe
            content rect. */}
        <view
          x={46}
          y={846}
          width={320}
          height={120}
          color={0x111114ff}
          borderRadius={14}
        >
          <text fontSize={13}>Low</text>
        </view>
      </Modal>
    ));
    await waitForUpdate();
    await settle();
    const dialog = openDialog('Low');
    const inner = dialog?.children[0] as lng.ElementNode | undefined;
    v.expect(inner).toBeDefined();
    const findings = lng.auditLayout(
      inner!,
      {
        x: 0,
        y: 24,
        width: 412,
        height: 892 - 24 - 16,
      },
      { tolerance: 1 },
    ).findings;
    v.expect(findings, describeFindings(findings)).not.toHaveLength(0);
    dispose();
    for (const child of lng.rootNode.children.slice()) {
      if (before.indexOf(child) !== -1) continue;
      lng.rootNode.removeChild(child);
      if (lng.isElementNode(child)) child.destroy();
    }
  });
});
