import {
  CapabilityError,
  loadService,
  peekService,
  serviceAvailable,
  useService,
  withService,
} from './registry.js';

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

export interface SharePort {
  share(options: ShareOptions): Promise<ShareResult>;
}

export interface DeviceInfoPort {
  get(): Promise<DeviceInfo>;
}

export interface BatteryPort {
  /** Undefined when the device has no battery to report. */
  get(): Promise<BatteryState | undefined>;
}

export interface MemoryPort {
  get(): DeviceMemoryInfo;
}

export interface KeepAwakePort {
  set(active: boolean): Promise<void>;
}

export interface OpenExternalPort {
  open(url: string): Promise<void>;
}

export interface OrientationPort {
  lock(orientation: OrientationLock): Promise<void>;
}

export interface AppReviewPort {
  request(): Promise<boolean>;
}

declare module './registry.js' {
  interface ServiceProviders {
    clipboard: ClipboardPort;
    share: SharePort;
    haptics: HapticsPort;
    deviceInfo: DeviceInfoPort;
    battery: BatteryPort;
    memory: MemoryPort;
    keepAwake: KeepAwakePort;
    openExternal: OpenExternalPort;
    orientation: OrientationPort;
    systemBars: SystemBarsPort;
    appReview: AppReviewPort;
  }
}

let appVersion: string | undefined;

/** Record the app version reported by `deviceInfo()`. */
export function setAppVersion(version: string | undefined): void {
  appVersion = version;
}

export async function readClipboard(): Promise<string> {
  return withService('clipboard', (port) => port.readText());
}

export async function writeClipboard(text: string): Promise<void> {
  return withService('clipboard', (port) => port.writeText(text));
}

/**
 * Open the platform share sheet. Where there is no share service, or it
 * reports that it cannot share here (most desktop browsers), the payload is
 * copied to the clipboard and the result is `copied` — the same graceful
 * fallback used by Capacitor.
 */
export async function share(options: ShareOptions): Promise<ShareResult> {
  if (serviceAvailable('share') === 'available') {
    try {
      // No tick before the port where it is already there, and none before
      // the copy below when the port refuses at once: the share sheet and the
      // clipboard both need the user's gesture.
      const port = peekService('share') ?? (await loadService('share'));
      return await port.share(options);
    } catch (error) {
      if (!(error instanceof CapabilityError)) throw error;
    }
  }
  const fallback = [options.title, options.text, options.url]
    .filter(Boolean)
    .join('\n');
  await writeClipboard(fallback);
  return 'copied';
}

/** Short physical feedback. A silent no-op on targets without haptics. */
export async function impact(style: HapticStyle = 'medium'): Promise<void> {
  if (serviceAvailable('haptics') === 'unavailable') return;
  return withService('haptics', (port) => port.impact(style));
}

/** Vibration pattern in milliseconds, as in the Vibration API. */
export async function vibrate(milliseconds = 20): Promise<void> {
  if (serviceAvailable('haptics') === 'unavailable') return;
  return withService('haptics', (port) => port.vibrate(milliseconds));
}

/** What the host reports about the device, plus the app version. */
export async function deviceInfo(): Promise<DeviceInfo> {
  const info = await withService('deviceInfo', (port) => port.get());
  return appVersion
    ? { ...info, appVersion: info.appVersion ?? appVersion }
    : info;
}

/**
 * Low-RAM signal for image cache/list window budgets. Android hosts can map
 * `ActivityManager.isLowRamDevice()`; the web host reports
 * `navigator.deviceMemory`. A host with no memory service reports no signal.
 */
export function deviceMemory(thresholdGb = 2): DeviceMemoryInfo {
  const info = peekService('memory')?.get();
  return {
    deviceMemoryGb: info?.deviceMemoryGb,
    lowMemory:
      info !== undefined &&
      (info.lowMemory ||
        (info.deviceMemoryGb !== undefined &&
          info.deviceMemoryGb <= thresholdGb)),
  };
}

/** Battery level/charging state, or `undefined` when the host has no API. */
export async function batteryState(): Promise<BatteryState | undefined> {
  if (serviceAvailable('battery') === 'unavailable') return undefined;
  return withService('battery', (port) => port.get());
}

/**
 * Keep the screen awake (video playback, recipes, dashboards). Mirrors Expo
 * `KeepAwake` / the Screen Wake Lock API. Repeated calls are reference-free:
 * `true` acquires once, `false` releases.
 */
export async function keepAwake(active: boolean): Promise<void> {
  return withService('keepAwake', (port) => port.set(active));
}

/** Lock orientation where the host supports it (Expo ScreenOrientation). */
export async function lockOrientation(
  orientation: OrientationLock,
): Promise<void> {
  // Nothing can hold a lock where there is no service, so releasing is done.
  if (
    orientation === 'any' &&
    serviceAvailable('orientation') === 'unavailable'
  )
    return;
  return withService('orientation', (port) => port.lock(orientation));
}

/**
 * Apply status/navigation bar colours and icon polarity. Android hosts map
 * this to `Window.setStatusBarColor` + `WindowInsetsController`; the web host
 * uses the theme-color meta tag. Returns a disposer that restores the
 * previous appearance.
 */
export function applySystemBarStyle(style: SystemBarStyle): () => void {
  return useService('systemBars').apply(style);
}

/**
 * Ask the store/host for an in-app review. Returns false when the host has no
 * review flow or declined to show it.
 */
export async function requestAppReview(): Promise<boolean> {
  if (serviceAvailable('appReview') === 'unavailable') return false;
  return withService('appReview', (port) => port.request());
}

/**
 * Open a URL in the system browser / in-app browser. Apps pass an https URL;
 * hosts decide whether to use `Linking.openURL` or an in-app browser tab.
 */
export async function openExternal(url: string): Promise<void> {
  return withService('openExternal', (port) => port.open(url));
}
