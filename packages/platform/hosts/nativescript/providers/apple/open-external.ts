import type { OpenExternalPort } from '@solid-multiplatform/platform/device';

export function openExternal(): OpenExternalPort {
  return {
    open: (url) =>
      new Promise<void>((resolve, reject) => {
        const target = NSURL.URLWithString(url);
        if (!target) {
          reject(new Error('Not a URL: ' + url));
          return;
        }
        UIApplication.sharedApplication.openURLOptionsCompletionHandler(
          target,
          NSDictionary.dictionary<string, unknown>(),
          (opened) => {
            if (opened) resolve();
            else reject(new Error('Nothing on this device opens ' + url));
          },
        );
      }),
  };
}
