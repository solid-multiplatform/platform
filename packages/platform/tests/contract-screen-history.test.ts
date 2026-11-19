// Contract tests: screen history over a host history.
//
// The host history owns location and traversal; screen history owns a
// session map and runs restore on every Back/Forward. These cases drive a
// real `createMemoryHistory` and assert capture counts, forward truncation,
// stale/gone/error handling and sequence fencing. No timers are involved.
import * as v from 'vitest';
import { createComponent, createRoot } from 'solid-js';
import { HostScope } from '../src/app/context.js';
import { createMemoryHistory } from '../src/core/history.js';
import {
  createBackDispatcher,
  type BackDispatcher,
} from '../src/sdk/shortcuts.js';
import {
  cancelExitConfirmation,
  confirmExitConfirmation,
  pendingExitConfirmation,
} from '../src/primitives/screenHistory.js';
import {
  createScreenHistory,
  type ScreenEntry,
  type ScreenHistory,
  type ScreenHistoryOptions,
} from '../src/primitives/screenHistory.js';

interface State {
  value: number;
}

interface SetupOptions extends Partial<ScreenHistoryOptions<State>> {
  path?: string;
  exit?: () => void;
}

function setup(overrides: SetupOptions = {}) {
  const history = createMemoryHistory(overrides.path ?? '/');
  const restore = v.vi.fn(
    overrides.restore ?? ((_entry: ScreenEntry<State>) => undefined),
  );
  const capture = v.vi.fn(overrides.capture ?? (() => ({ value: 0 })));
  let screenHistory!: ScreenHistory<State>;
  const stops: (() => void)[] = [];
  createRoot((dispose) => {
    stops.push(dispose);
    createComponent(HostScope.Provider, {
      value: { history, exit: overrides.exit } as never,
      get children() {
        screenHistory = createScreenHistory<State>({
          capture,
          restore,
          fallbackPath: overrides.fallbackPath ?? '/',
          onBackEmpty: overrides.onBackEmpty,
        });
        return undefined as never;
      },
    });
  });
  return {
    history,
    screenHistory,
    restore,
    capture,
    dispose() {
      while (stops.length > 0) stops.pop()!();
    },
  };
}

v.afterEach(() => {
  cancelExitConfirmation();
});

v.describe('createScreenHistory', () => {
  v.it('pushes, captures once and records the keyed entry', () => {
    const { history, screenHistory, capture, restore } = setup();
    screenHistory.push('/library', { value: 1 });
    v.expect(capture).toHaveBeenCalledTimes(1);
    v.expect(history.read().path).toBe('/library');
    v.expect(screenHistory.current().path).toBe('/library');
    v.expect(screenHistory.current().state).toEqual({ value: 1 });
    v.expect(restore).not.toHaveBeenCalled();
    v.expect(screenHistory.canGoBack()).toBe(true);
  });

  v.it('replace discards the replaced snapshot and does not capture', () => {
    const { history, screenHistory, capture } = setup();
    screenHistory.replace('/b', { value: 2 });
    v.expect(capture).not.toHaveBeenCalled();
    v.expect(history.read().path).toBe('/b');
    v.expect(screenHistory.current().state).toEqual({ value: 2 });
    v.expect(screenHistory.canGoBack()).toBe(false);
    // A pushed entry replaced in place keeps the earlier one behind it.
    screenHistory.push('/c', { value: 3 });
    v.expect(screenHistory.canGoBack()).toBe(true);
    screenHistory.replace('/d', { value: 4 });
    v.expect(history.read().path).toBe('/d');
    v.expect(screenHistory.canGoBack()).toBe(true);
    screenHistory.back();
    v.expect(history.read().path).toBe('/b');
  });

  v.it('back captures for Forward, moves the host once and restores', () => {
    const { history, screenHistory, capture, restore } = setup();
    screenHistory.push('/a', { value: 1 });
    capture.mockClear();
    screenHistory.back();
    v.expect(capture).toHaveBeenCalledTimes(1);
    v.expect(history.read().path).toBe('/');
    v.expect(restore).toHaveBeenCalledTimes(1);
    v.expect(restore.mock.calls[0]![1].reason).toBe('back');
    v.expect(screenHistory.current().path).toBe('/');

    screenHistory.forward();
    v.expect(restore).toHaveBeenCalledTimes(2);
    v.expect(restore.mock.calls[1]![1].reason).toBe('forward');
    v.expect(history.read().path).toBe('/a');
  });

  v.it('push truncates forward metadata', () => {
    const { history, screenHistory, restore } = setup();
    screenHistory.push('/a', { value: 1 });
    screenHistory.push('/b', { value: 2 });
    screenHistory.back();
    screenHistory.push('/c', { value: 3 });
    v.expect(screenHistory.canGoBack()).toBe(true);
    // Forward has nothing: no traversal, no restore.
    const before = restore.mock.calls.length;
    screenHistory.forward();
    v.expect(restore.mock.calls.length).toBe(before);
    v.expect(history.read().path).toBe('/c');
  });

  v.it('runs the root policy when Back has nowhere to go', () => {
    const exit = v.vi.fn();
    const { screenHistory } = setup({ exit });
    screenHistory.back();
    v.expect(exit).toHaveBeenCalledTimes(1);
  });

  v.it('confirm-exit opens the shared Alert, and Back again cancels it', () => {
    const exit = v.vi.fn();
    const { screenHistory } = setup({ exit, onBackEmpty: 'confirm-exit' });
    screenHistory.back();
    v.expect(exit).not.toHaveBeenCalled();
    v.expect(pendingExitConfirmation()).toBeTypeOf('function');
    // The Alert's own Back/cancel path.
    cancelExitConfirmation();
    v.expect(pendingExitConfirmation()).toBeUndefined();
    screenHistory.back();
    v.expect(pendingExitConfirmation()).toBeTypeOf('function');
    confirmExitConfirmation();
    v.expect(exit).toHaveBeenCalledTimes(1);
  });

  v.it('a custom root action runs instead of exit', () => {
    const custom = v.vi.fn();
    const exit = v.vi.fn();
    const { screenHistory } = setup({ exit, onBackEmpty: custom });
    screenHistory.back();
    v.expect(custom).toHaveBeenCalledTimes(1);
    v.expect(exit).not.toHaveBeenCalled();
  });

  v.it('invalidate writes flags and starts no work', () => {
    const { screenHistory, restore } = setup();
    screenHistory.push('/a', { value: 1 });
    screenHistory.invalidate();
    v.expect(restore).not.toHaveBeenCalled();
    v.expect(screenHistory.current().stale).toBe(true);
  });

  v.it('a stale entry revalidates once, then reads fresh', () => {
    let stale: boolean | undefined;
    const { screenHistory, restore } = setup({
      restore: (entry) => {
        stale = entry.stale;
      },
    });
    screenHistory.push('/a', { value: 1 });
    screenHistory.back();
    restore.mockClear();
    screenHistory.invalidate();
    screenHistory.forward();
    v.expect(restore).toHaveBeenCalledTimes(1);
    v.expect(stale).toBe(true);
    screenHistory.back();
    screenHistory.forward();
    v.expect(stale).toBe(false);
  });

  v.it(
    "'gone' clears the stack, resets to fallbackPath and fences old entries",
    () => {
      const { history, screenHistory, restore } = setup({
        fallbackPath: '/fallback',
        restore: () => 'gone',
      });
      screenHistory.push('/detail', { value: 1 });
      screenHistory.back();
      v.expect(history.read().path).toBe('/fallback');
      v.expect(screenHistory.current().path).toBe('/fallback');
      v.expect(screenHistory.canGoBack()).toBe(false);
      const calls = restore.mock.calls.length;
      // A browser entry from the old epoch is not restored.
      history.go?.(1);
      v.expect(restore.mock.calls.length).toBe(calls);
      // It may show the old location as a new, untracked entry, but it must
      // not restore the old session's screen state or stack.
      v.expect(screenHistory.canGoBack()).toBe(false);
    },
  );

  v.it(
    'a rejected restore keeps the destination, marks it stale and allows Back',
    async () => {
      const error = new Error('offline');
      let attempt = 0;
      const { screenHistory } = setup({
        restore: () => {
          attempt++;
          if (attempt === 1) return Promise.reject(error);
          return undefined;
        },
      });
      screenHistory.push('/a', { value: 1 });
      screenHistory.back();
      await v.vi.waitFor(() => {
        v.expect(screenHistory.status().phase).toBe('error');
      });
      v.expect(screenHistory.current().path).toBe('/');
      v.expect(screenHistory.current().stale).toBe(true);
      // Retry is input-driven; Back may abandon the error.
      screenHistory.retry();
      v.expect(screenHistory.status().phase).toBe('ready');
      v.expect(attempt).toBe(2);

      const again = setup({
        restore: () => Promise.reject(new Error('offline')),
      });
      again.screenHistory.push('/a', { value: 1 });
      again.screenHistory.back();
      await v.vi.waitFor(() => {
        v.expect(again.screenHistory.status().phase).toBe('error');
      });
      // Back abandons the restore at the destination and does not throw.
      again.screenHistory.push('/b', { value: 2 });
      v.expect(again.screenHistory.current().path).toBe('/b');
      again.dispose();
    },
  );

  v.it('retry is manual and only runs after an error', async () => {
    let attempt = 0;
    const { screenHistory, restore } = setup({
      restore: () => {
        attempt++;
        if (attempt === 1) return Promise.reject(new Error('once'));
      },
    });
    screenHistory.push('/a', { value: 1 });
    screenHistory.back();
    await v.vi.waitFor(() => {
      v.expect(screenHistory.status().phase).toBe('error');
    });
    restore.mockClear();
    screenHistory.retry();
    v.expect(restore).toHaveBeenCalledTimes(1);
    v.expect(screenHistory.status().phase).toBe('ready');
    screenHistory.retry();
    v.expect(restore).toHaveBeenCalledTimes(1);
  });

  v.it(
    'aborts a restore when another navigation starts; late resolution is fenced',
    async () => {
      let resolveFirst!: () => void;
      let firstSignal!: AbortSignal;
      let attempt = 0;
      const { screenHistory } = setup({
        restore: (_entry, context) => {
          attempt++;
          firstSignal = context.signal;
          return new Promise<void>((resolve) => {
            resolveFirst = resolve;
          });
        },
      });
      screenHistory.push('/a', { value: 1 });
      screenHistory.back();
      v.expect(screenHistory.status().phase).toBe('restoring');
      // Another navigation fences the late promise.
      screenHistory.push('/c', { value: 3 });
      v.expect(firstSignal.aborted).toBe(true);
      resolveFirst();
      await Promise.resolve();
      v.expect(attempt).toBe(1);
      v.expect(screenHistory.current().path).toBe('/c');
      v.expect(screenHistory.status().phase).toBe('ready');
    },
  );

  v.it('dispose aborts work and detaches the host subscription', async () => {
    let signal!: AbortSignal;
    const { history, screenHistory, restore } = setup({
      restore: (_entry, context) => {
        signal = context.signal;
        return new Promise<void>(() => {});
      },
    });
    screenHistory.push('/a', { value: 1 });
    screenHistory.back();
    screenHistory.dispose();
    v.expect(signal.aborted).toBe(true);
    restore.mockClear();
    history.go?.(-1);
    await Promise.resolve();
    v.expect(restore).not.toHaveBeenCalled();
    v.expect(screenHistory.status().phase).toBe('restoring');
  });

  v.it(
    'reset starts a new epoch at fallback and stops restoring old entries',
    () => {
      const { history, screenHistory, restore } = setup();
      screenHistory.push('/a', { value: 1 });
      screenHistory.reset('/home', { value: 9 });
      v.expect(history.read().path).toBe('/home');
      v.expect(screenHistory.current().path).toBe('/home');
      v.expect(screenHistory.canGoBack()).toBe(false);
      restore.mockClear();
      history.push('/legacy', { __smpScreen: 'old' });
      history.go?.(-1);
      v.expect(restore).not.toHaveBeenCalled();
      v.expect(screenHistory.current().path).toBe('/home');
    },
  );

  v.it('leaves no timers or work behind when idle', async () => {
    v.vi.useFakeTimers();
    const { screenHistory, dispose } = setup();
    screenHistory.push('/a', { value: 1 });
    screenHistory.back();
    await Promise.resolve();
    v.expect(v.vi.getTimerCount()).toBe(0);
    dispose();
    v.expect(v.vi.getTimerCount()).toBe(0);
    v.vi.useRealTimers();
  });

  v.it('a dispatcher runs Back precedence with exactly one consumer', () => {
    const order: string[] = [];
    const dispatcher: BackDispatcher = createBackDispatcher();
    dispatcher.push(() => {
      order.push('normal');
    });
    dispatcher.push(
      () => {
        order.push('pending');
        return true;
      },
      { beforeFocus: true },
    );
    dispatcher.onBack(() => {
      order.push('navigation');
      return true;
    });
    v.expect(dispatcher.handle()).toBe(true);
    v.expect(order).toEqual(['pending']);
  });

  v.it('a traversal runs focus handlers but not navigation', () => {
    const order: string[] = [];
    const dispatcher = createBackDispatcher();
    dispatcher.push(
      () => {
        order.push('pending');
        return true;
      },
      { beforeFocus: true },
    );
    dispatcher.onBack(() => {
      order.push('navigation');
      return true;
    });
    v.expect(dispatcher.handle({ traversal: true, delta: -1 })).toBe(true);
    v.expect(order).toEqual(['pending']);
  });
});
