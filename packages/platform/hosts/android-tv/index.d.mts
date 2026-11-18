import type { AndroidServicesOptions } from '../nativescript/providers/android/manifest.ts';

export function runAndroidTV(
  loadApp: (host: {
    target: 'android-tv';
    root: object;
    canvas: object;
  }) => Promise<{ mount(): () => void }>,
  options?: {
    surface?: 'texture-view' | 'surface-view';
    /** The settings namespace, the app's background jobs, preview services. */
    services?: Pick<AndroidServicesOptions, 'namespace' | 'jobs' | 'preview'>;
  },
): void;
