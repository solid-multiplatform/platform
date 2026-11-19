import type { Store } from '@solid-multiplatform/platform/services';

const errSecItemNotFound = -25300;

/**
 * Keychain generic passwords under one service name. Items are readable only
 * while the device is unlocked and never leave it (no iCloud Keychain, no
 * backup restore to another device).
 */
export function secureStorage(namespace: string): Store {
  const item = (name: string) => {
    const query = NSMutableDictionary.alloc<string, unknown>().init();
    query.setObjectForKey(kSecClassGenericPassword, kSecClass);
    query.setObjectForKey(namespace, kSecAttrService);
    query.setObjectForKey(name, kSecAttrAccount);
    return query;
  };
  const remove = (name: string) => {
    const status = SecItemDelete(item(name));
    if (status !== 0 && status !== errSecItemNotFound)
      throw new Error('Keychain delete failed with OSStatus ' + status);
  };
  return {
    async get(name) {
      const query = item(name);
      query.setObjectForKey(true, kSecReturnData);
      query.setObjectForKey(kSecMatchLimitOne, kSecMatchLimit);
      const found = new interop.Reference<NSData | null>();
      const status = SecItemCopyMatching(query, found);
      if (status === errSecItemNotFound) return null;
      if (status !== 0 || !found.value)
        throw new Error('Keychain read failed with OSStatus ' + status);
      return String(
        NSString.alloc().initWithDataEncoding(
          found.value,
          NSUTF8StringEncoding,
        ),
      );
    },
    async set(name, value) {
      remove(name);
      const attributes = item(name);
      attributes.setObjectForKey(
        NSString.stringWithString(value).dataUsingEncoding(
          NSUTF8StringEncoding,
        ),
        kSecValueData,
      );
      attributes.setObjectForKey(
        kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        kSecAttrAccessible,
      );
      const status = SecItemAdd(attributes, null);
      if (status !== 0)
        throw new Error('Keychain write failed with OSStatus ' + status);
    },
    async remove(name) {
      remove(name);
    },
  };
}
