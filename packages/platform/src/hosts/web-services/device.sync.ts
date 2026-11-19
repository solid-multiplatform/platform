/**
 * The browser's device services that cannot be loaded on first use. Importing
 * this module runs nothing: every port is an object whose methods read their
 * browser API only when called.
 *
 * Two kinds of service are here:
 *
 * - The ones a browser allows only while it is handling a user gesture
 *   (clipboard, share sheet, new tab, notification prompt, orientation and
 *   wake locks). Each method calls its browser API before its first `await`,
 *   so the call happens in the same turn as the app's.
 * - The ones a synchronous SDK function reads (memory, system bars, locale,
 *   colour scheme, key events).
 */
import type {
  ClipboardPort,
  KeepAwakePort,
  MemoryPort,
  OpenExternalPort,
  OrientationPort,
  SharePort,
  SystemBarsPort,
} from '../../sdk/device.js';
import type { LocalePort } from '../../sdk/i18n.js';
import { CapabilityError } from '../../sdk/registry.js';
import type { NotificationsPort, Permission } from '../../sdk/services.js';
import type { KeyEventsPort } from '../../sdk/shortcuts.js';
import type { ColorSchemePort } from '../../sdk/theme.jsx';

const writeWithLegacyCopy = (text: string): void => {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  const copied =
    typeof document.execCommand === 'function' && document.execCommand('copy');
  area.remove();
  if (!copied) throw new CapabilityError('clipboard');
};

// The Clipboard API is absent on insecure origins and old TV browsers.
const asyncClipboard = (): ClipboardPort | undefined =>
  (navigator as { clipboard?: ClipboardPort }).clipboard;

export const clipboard: ClipboardPort = {
  async readText() {
    const api = asyncClipboard();
    if (!api) throw new CapabilityError('clipboard.readText');
    return api.readText();
  },
  async writeText(text) {
    const api = asyncClipboard();
    if (api) return api.writeText(text);
    writeWithLegacyCopy(text);
  },
};

export const share: SharePort = {
  // Not `async`: a browser with no share sheet must refuse before returning,
  // so that `share()` can still copy to the clipboard inside the gesture.
  share(options) {
    if (typeof navigator.share !== 'function')
      throw new CapabilityError('share');
    const data: ShareData = {
      title: options.title,
      text: options.text,
      url: options.url,
    };
    // Blobs become Files, shared only where the browser says it can.
    if (options.files?.length && typeof File === 'function') {
      const files: File[] = [];
      for (const file of options.files) {
        if (!file.blob) continue;
        const type = file.mimeType ?? file.blob.type;
        files.push(new File([file.blob], file.name ?? 'file', { type }));
      }
      if (files.length && navigator.canShare?.({ files })) data.files = files;
    }
    return navigator.share(data).then(
      () => 'shared',
      (error: unknown) => {
        if ((error as { name?: string }).name === 'AbortError')
          return 'dismissed';
        throw error;
      },
    );
  },
};

export const openExternal: OpenExternalPort = {
  async open(url) {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) throw new CapabilityError('openExternal');
    opened.opener = null;
  },
};

export const orientation: OrientationPort = {
  async lock(value) {
    const target = (
      screen as {
        orientation?: {
          lock?(orientation: string): Promise<void>;
          unlock?(): void;
        };
      }
    ).orientation;
    if (value === 'any') {
      target?.unlock?.();
      return;
    }
    if (!target?.lock) throw new CapabilityError('orientation');
    await target.lock(value);
  },
};

// The one screen wake lock, held between `set(true)` and `set(false)`.
let wakeSentinel: { release(): Promise<void> } | undefined;

export const keepAwake: KeepAwakePort = {
  async set(active) {
    const wakeLock = (
      navigator as {
        wakeLock?: {
          request(type: 'screen'): Promise<{ release(): Promise<void> }>;
        };
      }
    ).wakeLock;
    if (!wakeLock) throw new CapabilityError('keepAwake');
    if (active) {
      wakeSentinel ??= await wakeLock.request('screen');
    } else if (wakeSentinel) {
      const held = wakeSentinel;
      wakeSentinel = undefined;
      await held.release();
    }
  },
};

const permissionOf = (value: NotificationPermission): Permission =>
  value === 'default' ? 'prompt' : value;

/**
 * Notifications through the service worker when the app has one (the only way
 * on Android browsers), otherwise through the page.
 */
export function notificationsThrough(
  worker?: ServiceWorkerRegistration,
): NotificationsPort {
  return {
    async permission() {
      return typeof Notification === 'undefined'
        ? 'unavailable'
        : permissionOf(Notification.permission);
    },
    async request() {
      return typeof Notification === 'undefined'
        ? 'unavailable'
        : permissionOf(await Notification.requestPermission());
    },
    async show({ title, body, id: tag, data }) {
      if (typeof Notification === 'undefined')
        throw new CapabilityError('notifications');
      if (Notification.permission !== 'granted')
        throw new Error('Notification permission required');
      if (worker) await worker.showNotification(title, { body, tag, data });
      else new Notification(title, { body, tag, data });
    },
  };
}

export const notifications: NotificationsPort = notificationsThrough();

export const memory: MemoryPort = {
  get() {
    // Chromium only; other browsers report no signal.
    const gb = (navigator as { deviceMemory?: number }).deviceMemory;
    return { deviceMemoryGb: gb, lowMemory: false };
  },
};

/** The browser has one system bar colour: the theme-color meta tag. */
export const systemBars: SystemBarsPort = {
  apply(style) {
    const existing = document.querySelector('meta[name="theme-color"]');
    const previous = existing?.getAttribute('content') ?? null;
    let meta: HTMLMetaElement | null = existing as HTMLMetaElement | null;
    let created = false;
    if (style.statusBarColor !== undefined) {
      const color = `#${(style.statusBarColor >>> 8)
        .toString(16)
        .padStart(6, '0')}`;
      if (!meta) {
        const createdMeta = document.createElement('meta');
        createdMeta.name = 'theme-color';
        meta = createdMeta;
        document.head.append(meta);
        created = true;
      }
      meta.setAttribute('content', color);
    }
    return () => {
      if (created) meta?.remove();
      else if (meta && previous !== null)
        meta.setAttribute('content', previous);
    };
  },
};

/** The browser's language, mirrored on the page's root element. */
export const locale: LocalePort = {
  current: () => navigator.language,
  apply(tag, direction) {
    document.documentElement.lang = tag;
    document.documentElement.dir = direction;
  },
  applyTextScale(scale) {
    document.documentElement.style.setProperty('--text-scale', String(scale));
  },
  applyHighContrast(enabled) {
    document.documentElement.classList.toggle('high-contrast', enabled);
  },
  subscribe(listener) {
    window.addEventListener('languagechange', listener);
    return () => window.removeEventListener('languagechange', listener);
  },
};

// Absent in some embedded browsers: the scheme is then `light`, unchanging.
const darkQuery = (): MediaQueryList | undefined =>
  typeof matchMedia === 'function'
    ? matchMedia('(prefers-color-scheme: dark)')
    : undefined;

export const colorScheme: ColorSchemePort = {
  current: () => (darkQuery()?.matches ? 'dark' : 'light'),
  subscribe(listener) {
    const query = darkQuery();
    const update = () => listener(query?.matches ? 'dark' : 'light');
    query?.addEventListener?.('change', update);
    return () => query?.removeEventListener?.('change', update);
  },
};

export const keyEvents: KeyEventsPort = {
  target: () => window,
  primaryModifier: () =>
    /Mac|iPhone|iPad/.test(navigator.platform) ? 'meta' : 'ctrl',
};
