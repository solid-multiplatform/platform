// The `notifications` service: the desktop's own notification service, over
// the session bus (native/src/notify.rs; org.freedesktop.Notifications).
//
// The manifest installs it only where the bus has that service. A desktop
// has no permission to ask for: where the service is, an app may notify.
//
// A notification is a title and a body. What the user does with it is not
// reported back (nothing listens on the bus, so a message's `data` goes
// nowhere), and it has no icon and no buttons.
import type {
  NotificationMessage,
  NotificationsPort,
} from '@solid-multiplatform/platform/services';

/** Whether this desktop shows notifications. Asks the session bus, once. */
export function notificationsAvailable(): boolean {
  return __solid.notifications?.available() ?? false;
}

/** `name` is what the notification says it is from. */
export function notifications(name: string): NotificationsPort {
  const native = __solid.notifications!;
  // A message with an id replaces the one shown before with the same id.
  const shown = new Map<string, number>();
  return {
    permission: async () => 'granted',
    request: async () => 'granted',
    show(message: NotificationMessage): Promise<void> {
      const replaces =
        message.id === undefined ? 0 : (shown.get(message.id) ?? 0);
      return new Promise((resolve, reject) => {
        native.show(
          name,
          message.title,
          message.body ?? '',
          replaces,
          (error, id) => {
            if (error !== null) return reject(error);
            if (message.id !== undefined) shown.set(message.id, id!);
            resolve();
          },
        );
      });
    },
  };
}
