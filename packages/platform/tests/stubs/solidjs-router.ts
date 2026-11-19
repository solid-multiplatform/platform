// The real @solidjs/router ships untranspiled .jsx compiled against a
// different solid moduleName, which vitest can't load. `Route` is all most
// tests need; `createRouter` is a small stand-in that runs the integration's
// `init` under the caller's owner and returns the props unchanged, which lets
// the router's history tests drive a real integration. `routerConfigs` and
// `routerNotifications` expose what the router built.
import { onCleanup } from 'solid-js';

export interface RouterIntegrationConfig {
  get(): unknown;
  set(change: unknown): void;
  init?(notify: (value?: unknown) => void): (() => void) | void;
  utils?: Record<string, unknown>;
}

export const Route = (props: unknown) => props;

/** The integration each mounted `HashRouter` built, in mount order. */
export const routerConfigs: RouterIntegrationConfig[] = [];

/** What each integration told its router after a change. */
export const routerNotifications: unknown[] = [];

/** What `createBeforeLeave().confirm` answers; tests replace it. */
export let routerBeforeLeave: (to: unknown) => boolean = () => true;

export function setRouterBeforeLeave(confirm: (to: unknown) => boolean): void {
  routerBeforeLeave = confirm;
}

export function createBeforeLeave() {
  return {
    confirm: (to: unknown) => routerBeforeLeave(to),
    subscribe: () => () => {},
  };
}

export function createRouter(config: RouterIntegrationConfig) {
  return (props: { children?: unknown }) => {
    routerConfigs.push(config);
    const remove = config.init?.((value) => routerNotifications.push(value));
    if (typeof remove === 'function') onCleanup(remove);
    return props.children;
  };
}
