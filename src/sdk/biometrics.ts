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

let port: BiometricsPort | undefined;

/** Register Face ID / Touch ID / BiometricPrompt. */
export function setBiometricsPort(next: BiometricsPort | undefined): void {
  port = next;
}

/**
 * Whether the host registered biometrics. Enrollment and hardware support are
 * host decisions; this only says whether app code can ask.
 */
export function biometricsAvailable(): boolean {
  return port !== undefined;
}

/**
 * Prompt for local authentication. Mirrors Expo `LocalAuthentication`: a
 * cancelled prompt is a normal `{ success: false, error: 'cancelled' }`, not
 * a thrown error, so screens can keep the user on the page.
 */
export async function authenticate(
  options: BiometricOptions,
): Promise<BiometricResult> {
  if (!port) return { success: false, error: 'unavailable' };
  return port.authenticate(options);
}
