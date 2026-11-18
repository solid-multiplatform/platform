import { SecureStorage } from '@nativescript/secure-storage';
import { secureStoragePort } from './providers.mjs';

export function createSecureStore(namespace) {
  // Require the native keychain even on Apple simulators.
  return secureStoragePort(
    new SecureStorage(
      globalThis.kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      true,
    ),
    namespace,
  );
}
