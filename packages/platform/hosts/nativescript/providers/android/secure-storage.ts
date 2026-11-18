import type { Store } from '../../../../src/sdk/services.js';
import { fromUtf8, strings, utf8, type AndroidApp } from './runtime.js';

const KEYSTORE = 'AndroidKeyStore';
const TRANSFORMATION = 'AES/GCM/NoPadding';
const NO_WRAP = 2; // android.util.Base64.NO_WRAP

/**
 * Values encrypted with an AES-256-GCM key that never leaves the Android
 * Keystore, the ciphertext kept in a private `SharedPreferences` file. Each
 * value has its own random nonce and is bound to its key name, so one entry
 * cannot be moved onto another. Uninstalling the app discards both.
 */
export function secureStorage(app: AndroidApp, namespace: string): Store {
  const alias = 'solid.secure.' + namespace;
  let preferences: android.content.SharedPreferences | undefined;
  let secret: java.security.Key | undefined;
  const open = (): android.content.SharedPreferences =>
    (preferences ??= app.context.getSharedPreferences(
      alias,
      android.content.Context.MODE_PRIVATE,
    ));
  const key = (): java.security.Key => {
    if (secret) return secret;
    const store = java.security.KeyStore.getInstance(KEYSTORE);
    store.load(null);
    const existing = store.getKey(alias, null);
    if (existing) return (secret = existing);
    const properties = android.security.keystore.KeyProperties;
    const generator = javax.crypto.KeyGenerator.getInstance(
      properties.KEY_ALGORITHM_AES,
      KEYSTORE,
    );
    generator.init(
      new android.security.keystore.KeyGenParameterSpec.Builder(
        alias,
        properties.PURPOSE_ENCRYPT | properties.PURPOSE_DECRYPT,
      )
        .setBlockModes(strings([properties.BLOCK_MODE_GCM]))
        .setEncryptionPaddings(strings([properties.ENCRYPTION_PADDING_NONE]))
        .setKeySize(256)
        .build(),
    );
    return (secret = generator.generateKey());
  };
  const base64 = android.util.Base64;
  return {
    async get(name) {
      const stored = open().getString(name, null);
      if (stored === null) return null;
      const [nonce, sealed] = stored.split(':');
      const cipher = javax.crypto.Cipher.getInstance(TRANSFORMATION);
      cipher.init(
        javax.crypto.Cipher.DECRYPT_MODE,
        key(),
        new javax.crypto.spec.GCMParameterSpec(
          128,
          base64.decode(nonce!, NO_WRAP),
        ),
      );
      cipher.updateAAD(utf8(name));
      return fromUtf8(cipher.doFinal(base64.decode(sealed!, NO_WRAP)));
    },
    async set(name, value) {
      const cipher = javax.crypto.Cipher.getInstance(TRANSFORMATION);
      cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, key());
      cipher.updateAAD(utf8(name));
      const sealed = cipher.doFinal(utf8(value));
      open()
        .edit()
        .putString(
          name,
          base64.encodeToString(cipher.getIV(), NO_WRAP) +
            ':' +
            base64.encodeToString(sealed, NO_WRAP),
        )
        .apply();
    },
    async remove(name) {
      open().edit().remove(name).apply();
    },
  };
}
