import type {
  BiometricError,
  BiometricResult,
  BiometricsPort,
} from '../../../../src/sdk/biometrics.js';
import { sdk, type AndroidApp } from './runtime.js';

let Callback:
  | (new () => android.hardware.biometrics.BiometricPrompt.AuthenticationCallback)
  | undefined;
// The open prompt's answer. One prompt can be open at a time.
let answer: ((result: BiometricResult) => void) | undefined;

function errorOf(code: number): BiometricError {
  const prompt = android.hardware.biometrics.BiometricPrompt;
  switch (code) {
    case prompt.BIOMETRIC_ERROR_CANCELED:
    case prompt.BIOMETRIC_ERROR_USER_CANCELED:
    case 13: // BIOMETRIC_ERROR_NEGATIVE_BUTTON, not public
      return 'cancelled';
    case prompt.BIOMETRIC_ERROR_LOCKOUT:
    case prompt.BIOMETRIC_ERROR_LOCKOUT_PERMANENT:
      return 'locked-out';
    case prompt.BIOMETRIC_ERROR_NO_BIOMETRICS:
      return 'not-enrolled';
    case prompt.BIOMETRIC_ERROR_HW_NOT_PRESENT:
    case prompt.BIOMETRIC_ERROR_HW_UNAVAILABLE:
    case prompt.BIOMETRIC_ERROR_NO_DEVICE_CREDENTIAL:
      return 'unavailable';
    default:
      return 'failed';
  }
}

/**
 * The platform `BiometricPrompt` (Android 9 and later). With a
 * `fallbackTitle` on Android 11 and later the device PIN, pattern or password
 * is accepted too; otherwise the prompt has a cancel button. A finger that
 * does not match leaves the prompt open, as the system intends. Needs the
 * `USE_BIOMETRIC` permission. Phone only.
 */
export function biometrics(app: AndroidApp): BiometricsPort {
  return {
    authenticate(options) {
      if (answer)
        return Promise.resolve({ success: false, error: 'failed' as const });
      return new Promise<BiometricResult>((resolve) => {
        const done = (result: BiometricResult): void => {
          answer = undefined;
          resolve(result);
        };
        answer = done;
        const context = app.context;
        const executor = context.getMainExecutor();
        const builder = new android.hardware.biometrics.BiometricPrompt.Builder(
          context,
        ).setTitle(options.reason);
        if (options.fallbackTitle !== undefined && sdk() >= 30) {
          const kinds =
            android.hardware.biometrics.BiometricManager.Authenticators;
          builder.setAllowedAuthenticators(
            kinds.BIOMETRIC_WEAK | kinds.DEVICE_CREDENTIAL,
          );
        } else
          builder.setNegativeButton(
            options.cancelTitle ?? 'Cancel',
            executor,
            new android.content.DialogInterface.OnClickListener({
              onClick: () => done({ success: false, error: 'cancelled' }),
            }),
          );
        Callback ??=
          android.hardware.biometrics.BiometricPrompt.AuthenticationCallback.extend(
            {
              onAuthenticationSucceeded: () => answer?.({ success: true }),
              onAuthenticationError: (code) =>
                answer?.({ success: false, error: errorOf(code) }),
            },
          );
        try {
          builder
            .build()
            .authenticate(
              new android.os.CancellationSignal(),
              executor,
              new Callback(),
            );
        } catch {
          done({ success: false, error: 'unavailable' });
        }
      });
    },
  };
}
