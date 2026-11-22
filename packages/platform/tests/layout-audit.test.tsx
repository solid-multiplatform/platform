// Layout audit: every overlay must fit the screens the framework ships to.
// These are build gates, not screenshots: the geometry is read from the
// laid-out tree and checked against the viewport and each visible panel.
//
// Pixel 7 Pro is 412×892 logical; the small phone is a 320-pt first-gen SE,
// the TV stage is 960×540 (Android TV) and 1920×1080 (Roku), the desktop is
// a 1440×900 window. A short landscape case is included because a rotated
// phone is the usual way a fixed dialog gets its footer cut off.
import * as v from 'vitest';
import { createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import {
  ActionSheet,
  ActivityIndicator,
  Column,
  DatePicker,
  Menu,
  Popover,
  Sheet,
  Alert,
  Slider,
  Switch,
  Drawer,
  Toast,
} from '@solid-multiplatform/platform/primitives';
import { TextField } from '@solid-multiplatform/platform/app';
import { renderer, waitForUpdate } from './setup.js';
import { updateViewport, zeroInsets } from '../src/sdk/viewport.js';
import { setCapabilities } from '../src/sdk/capabilities.js';

interface Profile {
  name: string;
  width: number;
  height: number;
  safeArea?: { top: number; right: number; bottom: number; left: number };
  tv?: boolean;
  /** A pure-touch phone host (Android/iOS) rather than a web window. */
  touch?: boolean;
  keyboard?: number;
}

const PROFILES: Profile[] = [
  { name: 'phone SE', width: 320, height: 568, touch: true },
  {
    name: 'phone 393',
    width: 393,
    height: 852,
    safeArea: { top: 47, bottom: 34, left: 0, right: 0 },
  },
  {
    name: 'Pixel 7 Pro',
    width: 412,
    height: 892,
    safeArea: { top: 24, bottom: 16, left: 0, right: 0 },
  },
  {
    name: 'phone large',
    width: 430,
    height: 932,
    safeArea: { top: 59, bottom: 34, left: 0, right: 0 },
  },
  {
    name: 'phone landscape',
    width: 892,
    height: 412,
    safeArea: { top: 0, bottom: 21, left: 47, right: 47 },
  },
  { name: 'Android TV', width: 960, height: 540, tv: true },
  { name: 'Roku 1080', width: 1920, height: 1080, tv: true },
  { name: 'desktop', width: 1440, height: 900 },
];

const resize = (profile: Profile) => {
  // The UI family decides the TV-sized panel and type, not the viewport's
  // name: set the capability the same way a host does.
  setCapabilities(
    profile.tv === true
      ? 'android-tv'
      : profile.touch === true
        ? 'android'
        : 'web',
  );
  updateViewport(
    {
      width: profile.width,
      height: profile.height,
      scale: 1,
      safeArea: profile.safeArea ?? zeroInsets,
      keyboardInset: profile.keyboard ?? 0,
      reducedMotion: false,
    },
    null,
  );
};

v.afterEach(() => setCapabilities('web'));

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 4));
}

function cutOff(profile: Profile): lng.LayoutFinding[] {
  const result = lng.auditLayout(
    lng.rootNode,
    { x: 0, y: 0, width: profile.width, height: profile.height },
    { tolerance: 1 },
  );
  return result.findings.filter((finding) => finding.severity === 'cut-off');
}

function findingsForAudit(profile: Profile): lng.LayoutFinding[] {
  return [...cutOff(profile), ...overflow(profile)];
}

function overflow(profile: Profile): lng.LayoutFinding[] {
  const result = lng.auditLayout(
    lng.rootNode,
    { x: 0, y: 0, width: profile.width, height: profile.height },
    { tolerance: 1 },
  );
  return result.findings.filter((finding) => finding.severity === 'overflow');
}

async function withProfile(
  profile: Profile,
  app: () => lng.JSX.Element,
  check: () => void,
) {
  resize(profile);
  const dispose = renderer.render(app);
  await waitForUpdate();
  await settle();
  try {
    check();
  } finally {
    dispose();
    // The portal belongs to the render; clear anything that survived it.
    for (const child of lng.rootNode.children.slice()) {
      lng.rootNode.removeChild(child);
      if (lng.isElementNode(child)) child.destroy();
    }
  }
}

const describeFindings = (findings: lng.LayoutFinding[]) =>
  findings.map((finding) => lng.formatLayoutFinding(finding)).join('\n');

v.describe('layout audit detects the failures it exists for', () => {
  v.test('a box past the viewport is cut off', async () => {
    await withProfile(
      { name: 'phone', width: 320, height: 568 },
      () => (
        <view width={320} height={568}>
          <view x={20} y={20} width={400} height={40} />
        </view>
      ),
      () => {
        const findings = cutOff({ name: 'phone', width: 320, height: 568 });
        v.expect(findings.length).toBeGreaterThan(0);
        v.expect(findings[0]!.severity).toBe('cut-off');
      },
    );
  });

  v.test('a child past its panel is reported', async () => {
    await withProfile(
      { name: 'phone', width: 320, height: 568 },
      () => (
        <view width={320} height={568}>
          <view x={20} y={20} width={280} height={200} color={0x111111ff}>
            {/* 300 wide inside a 280-wide panel: 20 units spill out. */}
            <view x={0} y={20} width={300} height={40} onEnter={() => true} />
          </view>
        </view>
      ),
      () => {
        const findings = overflow({ name: 'phone', width: 320, height: 568 });
        v.expect(findings.length).toBeGreaterThan(0);
        v.expect(findings[0]!.severity).toBe('overflow');
      },
    );
  });

  v.test('content inside a scroller is not reported', async () => {
    await withProfile(
      { name: 'phone', width: 320, height: 568 },
      () => (
        <view width={320} height={568}>
          <Column x={0} y={0} width={320} height={200} scroll="touch">
            <view width={320} height={200} />
            <view width={320} height={200} />
          </Column>
        </view>
      ),
      () => {
        const findings = [
          ...cutOff({ name: 'phone', width: 320, height: 568 }),
        ];
        v.expect(findings, describeFindings(findings)).toHaveLength(0);
      },
    );
  });
});

v.describe('overlays with the keyboard open', () => {
  const phoneKeyboard: Profile = {
    name: 'Pixel 7 Pro + keyboard',
    width: 412,
    height: 892,
    safeArea: { top: 24, bottom: 16, left: 0, right: 0 },
    keyboard: 360,
  };

  for (const [name, app] of [
    [
      'Alert',
      () => (
        <Alert
          visible
          title="Discard this playlist?"
          message="The name, cover and tracks you chose will be lost."
          confirmLabel="Discard"
          destructive
        />
      ),
    ],
    [
      'Sheet',
      () => (
        <Sheet visible label="Share" title="Share this playlist">
          <TextField label="Name" width={280} />
        </Sheet>
      ),
    ],
    [
      'Popover',
      () => (
        <Popover
          visible
          label="Queue"
          anchor={{ x: 300, y: 400, width: 44, height: 44 }}
          width={280}
          height={240}
        >
          <view width={280} height={240} />
        </Popover>
      ),
    ],
    [
      'Menu',
      () => (
        <Menu
          visible
          anchor={{ x: 20, y: 400, width: 120, height: 44 }}
          items={Array.from({ length: 12 }, (_, index) => ({
            label: `Track ${index + 1}`,
          }))}
        />
      ),
    ],
  ] as const) {
    v.test(`${name} stays above the keyboard`, async () => {
      await withProfile(phoneKeyboard, app as () => lng.JSX.Element, () => {
        const findings = findingsForAudit(phoneKeyboard);
        v.expect(findings, describeFindings(findings)).toHaveLength(0);
      });
    });
  }
});

v.describe('layout audit', () => {
  for (const profile of PROFILES) {
    v.test(`DatePicker fits a ${profile.name}`, async () => {
      const [open, setOpen] = createSignal(true);
      await withProfile(
        profile,
        () => (
          <DatePicker
            visible={open}
            value={new Date(2026, 10, 21)}
            onChange={() => undefined}
            onRequestClose={() => setOpen(false)}
          />
        ),
        () => {
          const findings = [...cutOff(profile), ...overflow(profile)];
          v.expect(findings, describeFindings(findings)).toHaveLength(0);
        },
      );
    });

    v.test(`DatePicker with time fits a ${profile.name}`, async () => {
      await withProfile(
        profile,
        () => (
          <DatePicker
            visible
            withTime
            value={new Date(2026, 10, 21, 10, 30)}
            onChange={() => undefined}
          />
        ),
        () => {
          const findings = [...cutOff(profile), ...overflow(profile)];
          v.expect(findings, describeFindings(findings)).toHaveLength(0);
        },
      );
    });

    v.test(`Alert fits a ${profile.name}`, async () => {
      await withProfile(
        profile,
        () => (
          <Alert
            visible
            title="Discard this playlist?"
            message="The name, cover and tracks you chose will be lost. This cannot be undone."
            confirmLabel="Discard"
            destructive
          />
        ),
        () => {
          const findings = [...cutOff(profile), ...overflow(profile)];
          v.expect(findings, describeFindings(findings)).toHaveLength(0);
        },
      );
    });

    v.test(`Alert with three actions fits a ${profile.name}`, async () => {
      await withProfile(
        profile,
        () => (
          <Alert
            visible
            title="Save changes?"
            message="You can discard the edits or keep editing."
            actions={[
              { label: 'Save' },
              { label: 'Discard', style: 'destructive' },
              { label: 'Cancel', style: 'cancel' },
            ]}
          />
        ),
        () => {
          const findings = [...cutOff(profile), ...overflow(profile)];
          v.expect(findings, describeFindings(findings)).toHaveLength(0);
        },
      );
    });

    v.test(`Sheet fits a ${profile.name}`, async () => {
      await withProfile(
        profile,
        () => (
          <Sheet visible label="Share" title="Share this playlist">
            <TextField label="Name" width={280} />
          </Sheet>
        ),
        () => {
          const findings = cutOff(profile);
          v.expect(findings, describeFindings(findings)).toHaveLength(0);
        },
      );
    });

    v.test(`Drawer fits a ${profile.name}`, async () => {
      await withProfile(
        profile,
        () => (
          <Drawer visible label="Advanced" title="Advanced" width={360}>
            <TextField label="Cache size" width={240} />
          </Drawer>
        ),
        () => {
          const findings = cutOff(profile);
          v.expect(findings, describeFindings(findings)).toHaveLength(0);
        },
      );
    });

    v.test(`Toast fits a ${profile.name}`, async () => {
      await withProfile(
        profile,
        () => (
          <Toast
            visible
            message="Playlist created"
            duration={0}
            actionLabel="Undo"
          />
        ),
        () => {
          const findings = cutOff(profile);
          v.expect(findings, describeFindings(findings)).toHaveLength(0);
        },
      );
    });

    v.test(`Menu fits a ${profile.name}`, async () => {
      const items = Array.from({ length: 18 }, (_, index) => ({
        label: `Track ${index + 1}`,
      }));
      await withProfile(
        profile,
        () => (
          <Menu
            visible
            anchor={{ x: 12, y: 40, width: 120, height: 44 }}
            items={items}
          />
        ),
        () => {
          const findings = cutOff(profile);
          v.expect(findings, describeFindings(findings)).toHaveLength(0);
        },
      );
    });

    v.test(
      `Switch, Slider and ActivityIndicator fit a ${profile.name}`,
      async () => {
        await withProfile(
          profile,
          () => (
            <view width={profile.width} height={profile.height}>
              <Switch label="Crossfade" checked width={260} x={16} y={16} />
              <Slider label="Volume" value={40} width={260} x={16} y={80} />
              <ActivityIndicator x={16} y={140} />
            </view>
          ),
          () => {
            const findings = [...cutOff(profile), ...overflow(profile)];
            v.expect(findings, describeFindings(findings)).toHaveLength(0);
          },
        );
      },
    );

    v.test(`ActionSheet fits a ${profile.name}`, async () => {
      await withProfile(
        profile,
        () => (
          <ActionSheet
            visible
            title="Track actions"
            message="Choose what to do with this track."
            actions={[
              { label: 'Play next' },
              { label: 'Add to queue' },
              { label: 'Delete from library', style: 'destructive' },
            ]}
          />
        ),
        () => {
          const findings = [...cutOff(profile), ...overflow(profile)];
          v.expect(findings, describeFindings(findings)).toHaveLength(0);
        },
      );
    });

    v.test(`Popover fits a ${profile.name}`, async () => {
      await withProfile(
        profile,
        () => (
          <Popover
            visible
            label="Queue"
            anchor={{
              x: profile.width - 80,
              y: profile.height - 90,
              width: 44,
              height: 44,
            }}
            width={300}
            height={190}
          >
            <view width={300} height={190} />
          </Popover>
        ),
        () => {
          const findings = [...cutOff(profile), ...overflow(profile)];
          v.expect(findings, describeFindings(findings)).toHaveLength(0);
        },
      );
    });
  }
});
