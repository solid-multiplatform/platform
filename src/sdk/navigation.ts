import { createSignal } from 'solid-js';

export interface Route {
  readonly path: string;
  readonly state?: unknown;
}
export function createNavigation(
  initial: Route,
  onChange?: (route: Route, mode: 'push' | 'replace' | 'back') => void,
) {
  const entries = [initial];
  const [route, setRoute] = createSignal(initial, { equals: false });
  let index = 0;
  function publish(mode: 'push' | 'replace' | 'back') {
    const next = entries[index]!;
    setRoute(next);
    onChange?.(next, mode);
  }
  return {
    route,
    canGoBack: () => {
      route();
      return index > 0;
    },
    push(next: Route) {
      entries.splice(index + 1, entries.length, next);
      index++;
      publish('push');
    },
    replace(next: Route) {
      entries[index] = next;
      publish('replace');
    },
    back() {
      if (!index) return false;
      index--;
      publish('back');
      return true;
    },
  };
}
