import { Application, ApplicationSettings } from '@nativescript/core';
import { LocalNotifications } from '@nativescript/local-notifications';
export function createNotificationPort(namespace) {
  const key = namespace + ':notification-permission-requested';
  async function permission() {
    if (Application.ios && typeof UNUserNotificationCenter !== 'undefined') {
      const settings = await new Promise((resolve) =>
        UNUserNotificationCenter.currentNotificationCenter().getNotificationSettingsWithCompletionHandler(
          resolve,
        ),
      );
      return settings.authorizationStatus === 0
        ? 'prompt'
        : settings.authorizationStatus === 1
          ? 'denied'
          : 'granted';
    }
    if (await LocalNotifications.hasPermission()) return 'granted';
    return ApplicationSettings.getBoolean(key, false) ? 'denied' : 'prompt';
  }
  return {
    permission,
    async request() {
      ApplicationSettings.setBoolean(key, true);
      await LocalNotifications.requestPermission();
      return permission();
    },
    async show({ title, body, data }) {
      if ((await permission()) !== 'granted')
        throw new Error('Notification permission required');
      await LocalNotifications.schedule([
        { title, body, userInfo: data, at: new Date() },
      ]);
    },
  };
}
