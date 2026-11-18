import { CapabilityError } from './services.js';

export type DevicePlatform =
  | 'web'
  | 'android'
  | 'ios'
  | 'desktop'
  | 'tv'
  | 'roku';

export interface DeviceInfo {
  platform: DevicePlatform;
  /** Hardware model or browser name. */
  model?: string;
  osVersion?: string;
  appVersion?: string;
  userAgent?: string;
}

export interface BatteryState {
  /** 0..1, matching the Battery Status API. */
  level: number;
  charging: boolean;
}

export interface DeviceMemoryInfo {
  /** Approximate physical memory in GiB, when the host reports it. */
  deviceMemoryGb?: number;
  /** True at or below the low-memory threshold. */
  lowMemory: boolean;
}

export interface SystemBarStyle {
  /** ARGB 0xAARRGGBB, the same format as scene colours. */
  statusBarColor?: number;
  navigationBarColor?: number;
  /** Dark glyphs for a light background. */
  lightStatusIcons?: boolean;
  lightNavigationIcons?: boolean;
}

export interface SystemBarsPort {
  /** Apply the style; the returned function restores the previous one. */
  apply(style: SystemBarStyle): () => void;
}

export interface ShareOptions {
  title?: string;
  text?: string;
  url?: string;
}

/** `shared` when the OS sheet accepted it, `copied` for the web fallback. */
export type ShareResult = 'shared' | 'copied' | 'dismissed';

export type HapticStyle = 'light' | 'medium' | 'heavy';
export type OrientationLock = 'portrait' | 'landscape' | 'any';

export interface ClipboardPort {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

export interface HapticsPort {
  impact(style: HapticStyle): Promise<void>;
  vibrate(milliseconds: number): Promise<void>;
}

/**
 * Ports a native or desktop host can provide. Every method is optional: when
 * a port is absent the web implementation is used, and unsupported optional
 * features (haptics) are silent no-ops.
 */
export interface DevicePorts {
  clipboard?: ClipboardPort;
  share?(options: ShareOptions): Promise<ShareResult>;
  haptics?: HapticsPort;
  deviceInfo?(): Promise<DeviceInfo>;
  battery?(): Promise<BatteryState>;
  memory?(): DeviceMemoryInfo;
  keepAwake?(active: boolean): Promise<void>;
  openExternal?(url: string): Promise<void>;
  lockOrientation?(orientation: OrientationLock): Promise<void>;
  systemBars?: SystemBarsPort;
  appReview?: { request(): Promise<boolean> };
}

let ports: DevicePorts = {};
let appVersion: string | undefined;

/**
 * Register host implementations. Hosts call this once during boot; app code
 * then uses the exported functions without knowing the target.
 */
export function setDevicePorts(next: DevicePorts): void {
  ports = { ...ports, ...next };
}

/** Remove host ports, e.g. when a test or a host is torn down. */
export function resetDevicePorts(): void {
  ports = {};
  appVersion = undefined;
}

/** Record the app version reported by `deviceInfo()`. */
export function setAppVersion(version: string): void {
  appVersion = version;
}

const navigatorLike = () =>
  typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & {
        clipboard?: ClipboardPort;
        share?(data: ShareData): Promise<void>;
        vibrate?(pattern: number | number[]): boolean;
        getBattery?(): Promise<{
          level: number;
          charging: boolean;
        }>;
        deviceMemory?: number;
        wakeLock?: {
          request(type: 'screen'): Promise<{ release(): Promise<void> }>;
        };
      });

const screenLike = () =>
  typeof screen === 'undefined'
    ? undefined
    : (screen as Screen & {
        orientation?: {
          lock?(orientation: string): Promise<void>;
          unlock?(): void;
        };
      });

const writeWithLegacyCopy = (text: string): void => {
  if (typeof document === 'undefined') {
    throw new CapabilityError('clipboard');
  }
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

const clipboardPort = (): ClipboardPort => {
  if (ports.clipboard) return ports.clipboard;
  const nav = navigatorLike();
  if (nav?.clipboard) {
    return {
      readText: () => nav.clipboard!.readText(),
      writeText: (text) => nav.clipboard!.writeText(text),
    };
  }
  if (typeof navigator !== 'undefined' && nav) {
    return {
      async readText() {
        throw new CapabilityError('clipboard.readText');
      },
      async writeText(text) {
        writeWithLegacyCopy(text);
      },
    };
  }
  throw new CapabilityError('clipboard');
};

export function readClipboard(): Promise<string> {
  return clipboardPort().readText();
}

export function writeClipboard(text: string): Promise<void> {
  return clipboardPort().writeText(text);
}

/**
 * Open the platform share sheet. On the web where `navigator.share` is
 * unavailable (most desktop browsers), the payload is copied to the clipboard
 * and the result is `copied` — the same graceful fallback used by Capacitor.
 */
export async function share(options: ShareOptions): Promise<ShareResult> {
  if (ports.share) return ports.share(options);
  const nav = navigatorLike();
  const payload = {
    title: options.title,
    text: options.text,
    url: options.url,
  };
  if (typeof nav?.share === 'function') {
    try {
      await nav.share(payload);
      return 'shared';
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') {
        return 'dismissed';
      }
      throw error;
    }
  }
  const fallback = [options.title, options.text, options.url]
    .filter(Boolean)
    .join('\n');
  await writeClipboard(fallback);
  return 'copied';
}

const vibrateWeb = (milliseconds: number): void => {
  const nav = navigatorLike();
  if (typeof nav?.vibrate === 'function') nav.vibrate(milliseconds);
};

/** Short physical feedback. A silent no-op on targets without haptics. */
export async function impact(style: HapticStyle = 'medium'): Promise<void> {
  if (ports.haptics) return ports.haptics.impact(style);
  vibrateWeb(style === 'light' ? 10 : style === 'heavy' ? 35 : 20);
}

/** Vibration pattern in milliseconds, as in the Vibration API. */
export async function vibrate(milliseconds = 20): Promise<void> {
  if (ports.haptics) return ports.haptics.vibrate(milliseconds);
  vibrateWeb(milliseconds);
}

export async function deviceInfo(): Promise<DeviceInfo> {
  if (ports.deviceInfo) {
    const info = await ports.deviceInfo();
    return appVersion
      ? { ...info, appVersion: info.appVersion ?? appVersion }
      : info;
  }
  const nav = navigatorLike();
  return {
    platform: 'web',
    model: nav?.userAgent,
    userAgent: nav?.userAgent,
    appVersion,
  };
}

/**
 * Low-RAM signal for image cache/list window budgets. Android hosts can map
 * `ActivityManager.isLowRamDevice()`; the web uses `navigator.deviceMemory`.
 */
export function deviceMemory(thresholdGb = 2): DeviceMemoryInfo {
  if (ports.memory) {
    const info = ports.memory();
    return {
      deviceMemoryGb: info.deviceMemoryGb,
      lowMemory:
        info.lowMemory ||
        (info.deviceMemoryGb !== undefined &&
          info.deviceMemoryGb <= thresholdGb),
    };
  }
  const value = navigatorLike()?.deviceMemory;
  return {
    deviceMemoryGb: value,
    lowMemory: value !== undefined && value <= thresholdGb,
  };
}

/** Battery level/charging state, or `undefined` when the host has no API. */
export async function batteryState(): Promise<BatteryState | undefined> {
  if (ports.battery) return ports.battery();
  const nav = navigatorLike();
  if (typeof nav?.getBattery !== 'function') return undefined;
  const battery = await nav.getBattery();
  return { level: battery.level, charging: battery.charging };
}

let wakeSentinel: { release(): Promise<void> } | undefined;

/**
 * Keep the screen awake (video playback, recipes, dashboards). Mirrors Expo
 * `KeepAwake` / the Screen Wake Lock API. Repeated calls are reference-free:
 * `true` acquires once, `false` releases.
 */
export async function keepAwake(active: boolean): Promise<void> {
  if (ports.keepAwake) return ports.keepAwake(active);
  const nav = navigatorLike();
  if (!nav?.wakeLock) throw new CapabilityError('keepAwake');
  if (active) {
    if (!wakeSentinel) wakeSentinel = await nav.wakeLock.request('screen');
  } else if (wakeSentinel) {
    const sentinel = wakeSentinel;
    wakeSentinel = undefined;
    await sentinel.release();
  }
}

/** Lock orientation where the host supports it (Expo ScreenOrientation). */
export async function lockOrientation(
  orientation: OrientationLock,
): Promise<void> {
  if (ports.lockOrientation) return ports.lockOrientation(orientation);
  const target = screenLike()?.orientation;
  if (orientation === 'any') {
    target?.unlock?.();
    return;
  }
  if (!target?.lock) throw new CapabilityError('lockOrientation');
  await target.lock(orientation);
}

/**
 * Apply status/navigation bar colours and icon polarity. Android hosts map
 * this to `Window.setStatusBarColor` + `WindowInsetsController`; the web
 * fallback is the theme-color meta tag. Returns a disposer that restores the
 * previous appearance.
 */
export function applySystemBarStyle(style: SystemBarStyle): () => void {
  if (ports.systemBars) return ports.systemBars.apply(style);
  if (typeof document === 'undefined') throw new CapabilityError('systemBars');
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
    else if (meta && previous !== null) meta.setAttribute('content', previous);
  };
}

/**
 * Ask the store/host for an in-app review. Returns false when the host has no
 * review flow or declined to show it.
 */
export async function requestAppReview(): Promise<boolean> {
  if (!ports.appReview) return false;
  return ports.appReview.request();
}

/**
 * Open a URL in the system browser / in-app browser. Apps pass an https URL;
 * hosts decide whether to use `Linking.openURL` or an in-app browser tab.
 */
export async function openExternal(url: string): Promise<void> {
  if (ports.openExternal) return ports.openExternal(url);
  if (typeof window === 'undefined') throw new CapabilityError('openExternal');
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) throw new CapabilityError('openExternal');
  opened.opener = null;
}
