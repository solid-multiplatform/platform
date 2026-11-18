import type { AndroidServicesOptions } from '../nativescript/providers/android/manifest.ts';

export function runAndroid(
  loadApp: (host: {
    target: 'android';
    root: object;
    canvas: object;
  }) => Promise<{ mount(): () => void }>,
  options?: {
    /** The settings namespace, the app's background jobs, preview services. */
    services?: Pick<AndroidServicesOptions, 'namespace' | 'jobs' | 'preview'>;
  },
): void;
