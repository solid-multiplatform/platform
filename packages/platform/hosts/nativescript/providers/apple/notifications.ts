import type {
  NotificationsPort,
  Permission,
} from '@solid-multiplatform/platform/services';

// UNAuthorizationOptions: badge | sound | alert
const badgeSoundAlert = 1 | 2 | 4;

/**
 * iOS only: local notifications through `UNUserNotificationCenter`. iOS
 * shows a notification only while the app is in the background, unless the
 * app sets a notification-centre delegate that presents it.
 */
export function notifications(): NotificationsPort {
  const center = () => UNUserNotificationCenter.currentNotificationCenter();
  const permission = () =>
    new Promise<Permission>((resolve) =>
      center().getNotificationSettingsWithCompletionHandler((settings) => {
        // UNAuthorizationStatus: notDetermined, denied, then the granted kinds.
        const status = Number(settings.authorizationStatus);
        resolve(status === 0 ? 'prompt' : status === 1 ? 'denied' : 'granted');
      }),
    );
  return {
    permission,
    request: () =>
      new Promise<Permission>((resolve, reject) =>
        center().requestAuthorizationWithOptionsCompletionHandler(
          badgeSoundAlert,
          (_granted, error) => {
            if (error) reject(new Error(error.localizedDescription));
            else resolve(permission());
          },
        ),
      ),
    show: (message) =>
      new Promise<void>((resolve, reject) => {
        const content = UNMutableNotificationContent.new();
        content.title = message.title;
        if (message.body !== undefined) content.body = message.body;
        if (message.data) {
          const data = NSMutableDictionary.alloc<string, string>().init();
          for (const key of Object.keys(message.data))
            data.setObjectForKey(message.data[key] ?? '', key);
          content.userInfo = data;
        }
        center().addNotificationRequestWithCompletionHandler(
          UNNotificationRequest.requestWithIdentifierContentTrigger(
            message.id ?? NSUUID.UUID().UUIDString,
            content,
            null,
          ),
          (error) => {
            if (error) reject(new Error(error.localizedDescription));
            else resolve();
          },
        );
      }),
  };
}
