import { createSignal, type Accessor } from 'solid-js';

export interface ServiceWorkerOptions {
  /** Defaults to `./sw.js` (relative to the app scope). */
  url?: string;
  scope?: string;
  onReady?(registration: ServiceWorkerRegistration): void;
  /** Called when a new worker is installed and an old one controls the page. */
  onUpdate?(registration: ServiceWorkerRegistration): void;
}

/**
 * Register the app service worker and surface updates. Returns undefined on
 * hosts without service workers. The generated web template calls this only
 * in production; apps can call it directly for custom setups.
 */
export async function registerServiceWorker(
  options: ServiceWorkerOptions = {},
): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
    return undefined;
  }
  const registration = await navigator.serviceWorker.register(
    options.url ?? './sw.js',
    options.scope ? { scope: options.scope } : undefined,
  );
  options.onReady?.(registration);
  registration.addEventListener?.('updatefound', () => {
    const installing = registration.installing;
    installing?.addEventListener?.('statechange', () => {
      if (
        installing.state === 'installed' &&
        navigator.serviceWorker.controller
      ) {
        options.onUpdate?.(registration);
      }
    });
  });
  return registration;
}

/** Ask the waiting worker to activate. Listen for `controllerchange` to reload. */
export async function activateServiceWorkerUpdate(
  registration: ServiceWorkerRegistration,
): Promise<void> {
  const waiting = registration.waiting;
  if (!waiting) return;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

/** Remove every service worker registration for this origin. */
export async function unregisterServiceWorkers(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker)
    return false;
  const registrations = await navigator.serviceWorker.getRegistrations();
  const results = await Promise.all(
    registrations.map((registration) => registration.unregister()),
  );
  return results.every(Boolean);
}

/** True when the app is launched from the installed PWA window. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if ((navigator as Navigator & { standalone?: boolean }).standalone) {
    return true;
  }
  return (
    typeof matchMedia !== 'undefined' &&
    matchMedia('(display-mode: standalone)').matches
  );
}

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface InstallPrompt {
  available: Accessor<boolean>;
  /** Show the browser install prompt. */
  prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

/**
 * Capture the browser's deferred `beforeinstallprompt` event. Browsers only
 * allow `prompt()` after a user gesture; call it from a button handler.
 */
export function createInstallPrompt(
  target: EventTarget | undefined = typeof window === 'undefined'
    ? undefined
    : window,
): InstallPrompt {
  const [event, setEvent] = createSignal<
    BeforeInstallPromptEvent | undefined
  >();
  if (target) {
    target.addEventListener('beforeinstallprompt', (candidate) => {
      candidate.preventDefault();
      setEvent(candidate as BeforeInstallPromptEvent);
    });
    target.addEventListener('appinstalled', () => setEvent(undefined));
  }
  return {
    available: () => event() !== undefined,
    async prompt() {
      const current = event();
      if (!current) return 'unavailable';
      await current.prompt();
      const choice = await current.userChoice;
      setEvent(undefined);
      return choice.outcome;
    },
  };
}
