import * as v from 'vitest';
import { createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import { AppErrorBoundary } from '@solid-multiplatform/platform/primitives';
import {
  reportCrash,
  resetCrashReporter,
  setCrashReporter,
} from '../src/sdk/crash.js';
import { renderer, waitForUpdate } from './setup.js';

const texts = (node: unknown): string[] => {
  const current = node as { text?: string; children?: readonly unknown[] };
  if (typeof current.text === 'string') return [current.text];
  return (current.children ?? []).flatMap((child) => texts(child));
};

v.describe('crash reporting', () => {
  v.afterEach(() => resetCrashReporter());

  v.it('forwards errors and ignores reporter failures', () => {
    const seen: string[] = [];
    setCrashReporter(({ error }) => {
      seen.push((error as Error).message);
    });
    reportCrash(new Error('boom'));
    v.expect(seen).toEqual(['boom']);

    setCrashReporter(() => {
      throw new Error('reporter failed');
    });
    v.expect(() => reportCrash(new Error('second'))).not.toThrow();
  });
});

v.describe('AppErrorBoundary', () => {
  v.afterEach(() => resetCrashReporter());

  v.it(
    'reports the error, shows the fallback and recovers on retry',
    async () => {
      const crashes: unknown[] = [];
      setCrashReporter(({ error }) => crashes.push(error));
      const [shouldThrow, setShouldThrow] = createSignal(true);
      let retried = 0;

      const MaybeThrow = () => {
        if (shouldThrow()) throw new Error('render failed');
        return <text>Recovered</text>;
      };

      const dispose = renderer.render(() => (
        <view width={800} height={600}>
          <AppErrorBoundary
            title="Screen unavailable"
            message="Retry the screen."
            onError={() => retried++}
          >
            <MaybeThrow />
          </AppErrorBoundary>
        </view>
      ));
      await waitForUpdate();
      await new Promise((resolve) => setTimeout(resolve, 0));

      v.expect((crashes[0] as Error).message).toBe('render failed');
      v.expect(retried).toBe(1);
      const rendered = texts(renderer.rootNode).join('|');
      v.expect(rendered).toContain('Screen unavailable');
      v.expect(rendered).toContain('Retry the screen.');

      setShouldThrow(false);
      const findAction = (node: unknown): lng.ElementNode | undefined => {
        const current = node as {
          onMouseClick?: lng.ElementNode['onMouseClick'];
          children?: readonly unknown[];
        };
        if (typeof current.onMouseClick === 'function') {
          return node as lng.ElementNode;
        }
        for (const child of current.children ?? []) {
          const found = findAction(child);
          if (found) return found;
        }
        return undefined;
      };
      const action = findAction(renderer.rootNode)!;
      action.onMouseClick?.(new MouseEvent('click'), action);
      await waitForUpdate();
      v.expect(texts(renderer.rootNode).join('|')).toContain('Recovered');
      dispose();
    },
  );
});
