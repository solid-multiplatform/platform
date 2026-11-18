/**
 * Runtime permissions as the SDK's `PermissionPort`: `granted`, `denied`
 * (asking again would show nothing), `prompt` (asking shows the system
 * prompt) or `unavailable` (the app's manifest does not declare it).
 *
 * Android reports only granted or not. Whether a refusal is final is worked
 * out from `shouldShowRequestPermissionRationale` and a note, in private
 * preferences, of which permissions the app has asked for: a permission never
 * asked for can still be prompted; one refused that the system would explain
 * can be prompted again; one refused without that is refused for good.
 * Querying never prompts.
 */
import type { PermissionPort } from '../../../../src/sdk/permissions.js';
import type { Permission } from '../../../../src/sdk/services.js';
import { promptPermissions } from './results.js';
import { sdk, type AndroidApp } from './runtime.js';

const GRANTED = 0; // PackageManager.PERMISSION_GRANTED

let declared: Set<string> | undefined;

function declaredPermissions(app: AndroidApp): Set<string> {
  if (declared) return declared;
  const info = app.context
    .getPackageManager()
    .getPackageInfo(
      app.context.getPackageName(),
      android.content.pm.PackageManager.GET_PERMISSIONS,
    );
  const names = info.requestedPermissions;
  declared = new Set();
  for (let i = 0; names && i < names.length; i++) declared.add(names[i]!);
  return declared;
}

const asked = (app: AndroidApp): android.content.SharedPreferences =>
  app.context.getSharedPreferences('solid.permissions', 0);

/**
 * A permission port over one runtime permission, or several asked for
 * together (coarse and fine location): `granted` when any of them is.
 */
export function androidPermission(
  app: AndroidApp,
  names: readonly string[],
): PermissionPort {
  const key = names[0]!;
  const query = async (): Promise<Permission> => {
    const known = declaredPermissions(app);
    const usable = names.filter((name) => known.has(name));
    if (!usable.length) return 'unavailable';
    if (
      usable.some((name) => app.context.checkSelfPermission(name) === GRANTED)
    )
      return 'granted';
    if (!asked(app).getBoolean(key, false)) return 'prompt';
    const activity = app.foregroundActivity ?? app.startActivity;
    return activity &&
      usable.some((name) => activity.shouldShowRequestPermissionRationale(name))
      ? 'prompt'
      : 'denied';
  };
  let open: Promise<Permission> | undefined;
  return {
    query,
    request() {
      open ??= query()
        .then(async (state) => {
          if (state !== 'prompt') return state;
          const known = declaredPermissions(app);
          await promptPermissions(
            app,
            names.filter((name) => known.has(name)),
          );
          asked(app).edit().putBoolean(key, true).apply();
          return query();
        })
        .finally(() => {
          open = undefined;
        });
      return open;
    },
  };
}

/** A port for a permission that exists only from an API level on. */
export function androidPermissionSince(
  app: AndroidApp,
  level: number,
  names: readonly string[],
): PermissionPort {
  if (sdk() >= level) return androidPermission(app, names);
  const granted = async (): Promise<Permission> => 'granted';
  return { query: granted, request: granted };
}

export const locationPermission = (app: AndroidApp): PermissionPort =>
  androidPermission(app, [
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
  ]);

/** Notifications need no runtime permission before Android 13. */
export const notificationPermission = (app: AndroidApp): PermissionPort =>
  androidPermissionSince(app, 33, ['android.permission.POST_NOTIFICATIONS']);

export const contactsPermission = (app: AndroidApp): PermissionPort =>
  androidPermission(app, ['android.permission.READ_CONTACTS']);

export const calendarPermission = (app: AndroidApp): PermissionPort =>
  androidPermission(app, ['android.permission.READ_CALENDAR']);

/** Step counting needs this from Android 10. */
export const activityPermission = (app: AndroidApp): PermissionPort =>
  androidPermissionSince(app, 29, ['android.permission.ACTIVITY_RECOGNITION']);

/**
 * Every permission the providers gate a service on, by the name an app asks
 * with, for the SDK's `createPermissions`.
 */
export function androidPermissions(
  app: AndroidApp,
): Record<string, PermissionPort> {
  return {
    location: locationPermission(app),
    notifications: notificationPermission(app),
    contacts: contactsPermission(app),
    calendar: calendarPermission(app),
    'activity-recognition': activityPermission(app),
  };
}

/** Rejects unless the permission is granted, prompting where it can. */
export async function requirePermission(
  port: PermissionPort,
  what: string,
): Promise<void> {
  const state = await port.request();
  if (state !== 'granted') throw new Error(`${what} permission is ${state}`);
}
