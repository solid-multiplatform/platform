// The browser history source notifies on every traversal the browser makes.
// Back between two entries with the SAME hash raises no `hashchange`, so
// without `popstate` the router never hears those Backs: the session stack
// desyncs and the next Back skips a screen.
import { describe, expect, test, vi } from 'vitest';
import { createBrowserHistory } from '../src/hosts/web-history.js';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createBrowserHistory', () => {
  test(
    'Back between same-hash entries reaches the subscriber',
    { timeout: 20000 },
    async () => {
      window.location.hash = '';
      const history = createBrowserHistory();
      const listener = vi.fn();
      const stop = history.subscribe(listener);

      // Two entries, identical hash, different state: a Back here changes
      // no fragment, so `hashchange` stays silent.
      history.push('/detail', { id: 'a' } as never);
      history.push('/detail', { id: 'b' } as never);
      expect(listener).not.toHaveBeenCalled();

      window.history.go(-1);
      await settle();
      // popstate fired with no hash change: the router heard the Back.
      expect(listener.mock.calls.length).toBeGreaterThanOrEqual(1);
      stop();
    },
  );
});
