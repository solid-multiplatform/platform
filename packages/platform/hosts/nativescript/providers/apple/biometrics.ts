import type {
  BiometricError,
  BiometricsPort,
} from '@solid-multiplatform/platform/biometrics';

const LAPolicyDeviceOwnerAuthenticationWithBiometrics = 1;

/** LAError codes. */
function reason(code: number | undefined): BiometricError {
  switch (code) {
    case -2: // userCancel
    case -3: // userFallback
    case -4: // systemCancel
    case -9: // appCancel
      return 'cancelled';
    case -5: // passcodeNotSet
    case -7: // biometryNotEnrolled
      return 'not-enrolled';
    case -6: // biometryNotAvailable
      return 'unavailable';
    case -8: // biometryLockout
      return 'locked-out';
    default:
      return 'failed';
  }
}

/**
 * iOS only: Face ID or Touch ID through `LAContext`. An app that can show
 * Face ID must declare `NSFaceIDUsageDescription`.
 */
export function biometrics(): BiometricsPort {
  return {
    authenticate: (options) =>
      new Promise((resolve) => {
        const context = LAContext.new();
        if (options.fallbackTitle !== undefined)
          context.localizedFallbackTitle = options.fallbackTitle;
        if (options.cancelTitle !== undefined)
          context.localizedCancelTitle = options.cancelTitle;
        const policy = LAPolicyDeviceOwnerAuthenticationWithBiometrics;
        const refused = new interop.Reference<NSError>();
        if (!context.canEvaluatePolicyError(policy, refused)) {
          resolve({ success: false, error: reason(refused.value?.code) });
          return;
        }
        context.evaluatePolicyLocalizedReasonReply(
          policy,
          options.reason,
          (success, error) =>
            resolve(
              success
                ? { success: true }
                : { success: false, error: reason(error?.code) },
            ),
        );
      }),
  };
}
