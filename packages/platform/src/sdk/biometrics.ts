import { serviceAvailable, withService } from './registry.js';

export type BiometricError =
  | 'cancelled'
  | 'failed'
  | 'locked-out'
  | 'unavailable'
  | 'not-enrolled';

export interface BiometricResult {
  success: boolean;
  error?: BiometricError;
}

export interface BiometricOptions {
  /** Shown by Face ID / BiometricPrompt. */
  reason: string;
  /** Label for the device-credential fallback. */
  fallbackTitle?: string;
  cancelTitle?: string;
}

export interface BiometricsPort {
  authenticate(options: BiometricOptions): Promise<BiometricResult>;
}

declare module './registry.js' {
  interface ServiceProviders {
    /** Face ID / Touch ID / BiometricPrompt. */
    biometrics: BiometricsPort;
  }
}

/**
 * Whether the host registered biometrics. Enrollment and hardware support are
 * host decisions; this only says whether app code can ask.
 */
export function biometricsAvailable(): boolean {
  return serviceAvailable('biometrics') === 'available';
}

/**
 * Prompt for local authentication. Mirrors Expo `LocalAuthentication`: a
 * cancelled prompt is a normal `{ success: false, error: 'cancelled' }`, not
 * a thrown error, so screens can keep the user on the page.
 */
export async function authenticate(
  options: BiometricOptions,
): Promise<BiometricResult> {
  if (!biometricsAvailable()) return { success: false, error: 'unavailable' };
  return withService('biometrics', (port) => port.authenticate(options));
}
