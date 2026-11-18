import type {
  NotificationsPort,
  Permission,
} from '../../../../src/sdk/services.js';
import type { PermissionPort } from '../../../../src/sdk/permissions.js';
import { notificationPermission } from './permission.js';
import { sdk, type AndroidApp } from './runtime.js';

const CHANNEL = 'solid.default';

/**
 * Local notifications: one default-importance `NotificationChannel` named
 * after the app, and `Notification.Builder`. Tapping one opens the app.
 * Android 13 and later ask for `POST_NOTIFICATIONS`. Phone only.
 */
export function notifications(
  app: AndroidApp,
): NotificationsPort & { permission: PermissionPort['query'] } {
  const context = app.context;
  const manager = (): android.app.NotificationManager =>
    context.getSystemService(android.content.Context.NOTIFICATION_SERVICE);
  const runtime = notificationPermission(app);
  // The user can also switch an app's notifications off in system settings.
  const allowed = (state: Permission): Permission =>
    state === 'granted' && !manager().areNotificationsEnabled()
      ? 'denied'
      : state;
  const permission = (): Promise<Permission> => runtime.query().then(allowed);
  let sequence = 0;
  return {
    permission,
    request: () => runtime.request().then(allowed),
    async show(message) {
      if ((await permission()) !== 'granted')
        throw new Error('Notification permission required');
      let builder: android.app.Notification.Builder;
      if (sdk() >= 26) {
        // Creating a channel that exists changes nothing.
        manager().createNotificationChannel(
          new android.app.NotificationChannel(
            CHANNEL,
            context.getApplicationInfo().loadLabel(context.getPackageManager()),
            android.app.NotificationManager.IMPORTANCE_DEFAULT,
          ),
        );
        builder = new android.app.Notification.Builder(context, CHANNEL);
      } else builder = new android.app.Notification.Builder(context);
      builder
        .setSmallIcon(context.getApplicationInfo().icon)
        .setContentTitle(message.title)
        .setAutoCancel(true);
      if (message.body !== undefined) builder.setContentText(message.body);
      const launch = context
        .getPackageManager()
        .getLaunchIntentForPackage(context.getPackageName());
      if (launch) {
        const extras = new android.os.Bundle();
        for (const [name, value] of Object.entries(message.data ?? {}))
          extras.putString(name, value);
        builder.setExtras(extras);
        launch.putExtras(extras);
        builder.setContentIntent(
          android.app.PendingIntent.getActivity(
            context,
            sequence,
            launch,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT |
              android.app.PendingIntent.FLAG_IMMUTABLE,
          ),
        );
      }
      // A message with an id replaces the earlier one with that id.
      if (message.id !== undefined)
        manager().notify(message.id, 0, builder.build());
      else manager().notify(++sequence, builder.build());
    },
  };
}
