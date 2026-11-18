import type { SensorType } from '../../../../src/sdk/sensors.js';
import type { AndroidApp } from './runtime.js';

/**
 * What the device and the app's manifest allow, read once when the host
 * starts. Each field decides whether a service is offered at all.
 */
export interface AndroidFeatures {
  /** `Build.VERSION.SDK_INT`. */
  sdk: number;
  /** Permissions the app's manifest declares. */
  permissions: readonly string[];
  battery: boolean;
  vibrator: boolean;
  /** Camera hardware, a camera app, and the FileProvider to receive a photo. */
  camera: boolean;
  location: boolean;
  /** A fingerprint, face or iris sensor. */
  biometrics: boolean;
  pictureInPicture: boolean;
  /** At least one of the sensors the SDK names. */
  sensors: boolean;
  /** An app answers the share sheet. */
  share: boolean;
  /** An app opens web addresses. */
  browser: boolean;
  /** An app opens `geo:` addresses. */
  maps: boolean;
  /** The system document picker. */
  documents: boolean;
  /** Google Play's in-app review library is in the app. */
  playReview: boolean;
}

/** The system features that say a device has each sensor. */
export const SENSOR_FEATURES: Record<SensorType, string> = {
  accelerometer: 'android.hardware.sensor.accelerometer',
  magnetometer: 'android.hardware.sensor.compass',
  gyroscope: 'android.hardware.sensor.gyroscope',
  light: 'android.hardware.sensor.light',
  barometer: 'android.hardware.sensor.barometer',
  proximity: 'android.hardware.sensor.proximity',
  'step-counter': 'android.hardware.sensor.stepcounter',
};

/**
 * Whether the device has a battery, from the sticky battery broadcast. Read
 * with a null receiver: nothing is registered.
 */
export function batteryPresent(context: android.content.Context): boolean {
  const sticky = context.registerReceiver(
    null,
    new android.content.IntentFilter(
      android.content.Intent.ACTION_BATTERY_CHANGED,
    ),
  );
  return (
    sticky?.getBooleanExtra(android.os.BatteryManager.EXTRA_PRESENT, false) ??
    false
  );
}

export function vibrator(
  context: android.content.Context,
): android.os.Vibrator | null {
  return context.getSystemService(android.content.Context.VIBRATOR_SERVICE);
}

/** Whether the app was built with Google Play's in-app review library. */
export function playReviewPresent(): boolean {
  try {
    java.lang.Class.forName(
      'com.google.android.play.core.review.ReviewManagerFactory',
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the features from the device: a handful of package-manager lookups
 * and one sticky broadcast. Nothing is registered and nothing keeps running.
 * An app is visible to these lookups only where the manifest's `<queries>`
 * names its intent (Android 11 and later).
 */
export function detectAndroidFeatures(app: AndroidApp): AndroidFeatures {
  const context = app.context;
  const packages = context.getPackageManager();
  const Intent = android.content.Intent;
  const has = (feature: string): boolean => packages.hasSystemFeature(feature);
  const opens = (intent: android.content.Intent): boolean =>
    packages.resolveActivity(intent, 0) !== null;
  const view = (address: string): android.content.Intent =>
    new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(address));
  const declared = packages.getPackageInfo(
    context.getPackageName(),
    android.content.pm.PackageManager.GET_PERMISSIONS,
  ).requestedPermissions;
  const permissions: string[] = [];
  for (let i = 0; declared && i < declared.length; i++)
    permissions.push(String(declared[i]));
  return {
    sdk: android.os.Build.VERSION.SDK_INT,
    permissions,
    battery: batteryPresent(context),
    vibrator: vibrator(context)?.hasVibrator() ?? false,
    camera:
      has('android.hardware.camera.any') &&
      opens(new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE)) &&
      packages.resolveContentProvider(
        context.getPackageName() + '.solid.files',
        0,
      ) !== null,
    location: has('android.hardware.location'),
    biometrics:
      has('android.hardware.fingerprint') ||
      has('android.hardware.biometrics.face') ||
      has('android.hardware.biometrics.iris'),
    pictureInPicture: has('android.software.picture_in_picture'),
    sensors: Object.values(SENSOR_FEATURES).some(has),
    share: opens(new Intent(Intent.ACTION_SEND).setType('text/plain')),
    browser: opens(
      view('https://example.com').addCategory(Intent.CATEGORY_BROWSABLE),
    ),
    maps: opens(view('geo:0,0')),
    documents: opens(
      new Intent(Intent.ACTION_OPEN_DOCUMENT)
        .addCategory(Intent.CATEGORY_OPENABLE)
        .setType('*/*'),
    ),
    playReview: playReviewPresent(),
  };
}
