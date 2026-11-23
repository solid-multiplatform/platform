// Contract tests: Skeleton and SkeletonText — content-shaped placeholders.
// Static by default (nothing scheduled, per the idle rule); `pulse` animates
// one node only while mounted and follows Config.animationsEnabled.
import * as v from 'vitest';
import * as lng from '@solid-multiplatform/platform';
import {
  Skeleton,
  SkeletonText,
} from '@solid-multiplatform/platform/primitives';
import { renderer } from './setup.js';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Mount a Skeleton whose node's `animate` is spied before any effect runs:
 * the ref fires before the pulse effect, so the spy sees every call and the
 * controller's methods are recorded rather than driving a real animation.
 */
function mountSpy(extra: Record<string, unknown>): {
  calls: Array<{ props: unknown; settings: unknown }>;
  started: number;
  stopped: number;
  restored: number;
  node: lng.ElementNode;
  dispose(): void;
} {
  const calls: Array<{ props: unknown; settings: unknown }> = [];
  let started = 0;
  let stopped = 0;
  let restored = 0;
  let node!: lng.ElementNode;
  const dispose = renderer.render(() => (
    <view width={400} height={200}>
      <Skeleton
        {...extra}
        ref={(el: lng.ElementNode) => {
          node = el;
          const original = el.animate.bind(el);
          el.animate = ((props: unknown, settings: unknown) => {
            calls.push({ props, settings });
            const real = original(props as never, settings as never);
            return {
              start: () => {
                started++;
                return real.start();
              },
              stop: () => {
                stopped++;
                return real.stop();
              },
              restore: () => {
                restored++;
                return real.restore();
              },
            } as typeof real;
          }) as typeof original;
        }}
        width={320}
        height={180}
      />
    </view>
  )) as unknown as () => void;
  // Getters: the counters are closure variables the mock increments.
  return {
    calls,
    get started() {
      return started;
    },
    get stopped() {
      return stopped;
    },
    get restored() {
      return restored;
    },
    node,
    dispose,
  };
}

v.describe('Skeleton', () => {
  v.afterEach(() => {
    lng.Config.animationsEnabled = true;
  });

  v.test('draws a rounded block, unfocusable and labelled', async () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={400} height={200}>
        <Skeleton
          ref={(el: lng.ElementNode) => (node = el)}
          x={8}
          y={8}
          width={320}
          height={180}
          label="Album cover"
        />
      </view>
    )) as unknown as () => void;
    try {
      await tick();
      v.expect(node.x).toBe(8);
      v.expect(node.width).toBe(320);
      v.expect(node.height).toBe(180);
      v.expect(node.skipFocus).toBe(true);
      v.expect(typeof node.borderRadius).toBe('number');
      v.expect(node.ariaLabel).toBe('Album cover');
    } finally {
      dispose();
    }
  });

  v.test('static by default: nothing is ever animated', async () => {
    const spy = mountSpy({});
    try {
      await tick();
      v.expect(spy.calls.length).toBe(0);
    } finally {
      spy.dispose();
    }
  });

  v.test(
    'with pulse, one animation starts, and cleanup stops and restores',
    async () => {
      // isolate: false shares Config across files; make the precondition ours.
      const wasEnabled = lng.Config.animationsEnabled;
      lng.Config.animationsEnabled = true;
      const spy = mountSpy({ pulse: true });
      try {
        await tick();
        v.expect(spy.calls.length).toBe(1);
        v.expect(spy.calls[0]!.props).toEqual({ alpha: 0.45 });
        const settings = spy.calls[0]!.settings as {
          duration: number;
          loop: boolean;
        };
        v.expect(settings.duration).toBeGreaterThan(0);
        v.expect(settings.loop).toBe(true);
        v.expect(spy.started).toBe(1);
      } finally {
        spy.dispose();
      }
      // Unmount: the teardown runs a tick later; the loop is stopped and the
      // node's alpha restored.
      await tick();
      v.expect(spy.stopped).toBe(1);
      v.expect(spy.restored).toBe(1);
      lng.Config.animationsEnabled = wasEnabled;
    },
  );

  v.test('pulse is off entirely when animations are disabled', async () => {
    lng.Config.animationsEnabled = false;
    const spy = mountSpy({ pulse: true });
    try {
      await tick();
      v.expect(spy.calls.length).toBe(0);
    } finally {
      spy.dispose();
      lng.Config.animationsEnabled = true;
    }
  });
});

v.describe('SkeletonText', () => {
  v.test(
    'draws lines of bars, the last one shorter, stacked downward',
    async () => {
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view width={400} height={200}>
          <SkeletonText
            ref={(el: lng.ElementNode) => (node = el)}
            width={320}
            lines={4}
          />
        </view>
      )) as unknown as () => void;
      try {
        await tick();
        const bars = node.children as lng.ElementNode[];
        v.expect(bars.length).toBe(4);
        for (let i = 0; i < 3; i++) {
          v.expect(bars[i]!.width).toBe(320);
          v.expect(bars[i]!.skipFocus).toBe(true);
        }
        v.expect(bars[3]!.width).toBeLessThan(320);
        v.expect(bars[3]!.width).toBeGreaterThan(150);
        v.expect(bars[1]!.y).toBeGreaterThan(bars[0]!.y);
      } finally {
        dispose();
      }
    },
  );
});
