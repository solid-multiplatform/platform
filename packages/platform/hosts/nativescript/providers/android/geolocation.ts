import type {
  GeoOptions,
  GeolocationPort,
  GeoPosition,
} from '../../../../src/sdk/geolocation.js';
import type { PermissionPort } from '../../../../src/sdk/permissions.js';
import { locationPermission, requirePermission } from './permission.js';
import { mainHandler, sdk, type AndroidApp } from './runtime.js';

function position(location: android.location.Location): GeoPosition {
  return {
    latitude: location.getLatitude(),
    longitude: location.getLongitude(),
    accuracy: location.hasAccuracy() ? location.getAccuracy() : 0,
    altitude: location.hasAltitude() ? location.getAltitude() : undefined,
    heading: location.hasBearing() ? location.getBearing() : undefined,
    speed: location.hasSpeed() ? location.getSpeed() : undefined,
    timestamp: location.getTime(),
  };
}

/**
 * `LocationManager`. Nothing is registered until an app asks for a fix or
 * watches, and a watch's listener is removed by its disposer. Every callback
 * arrives on the main looper. Asks for the location permission where it can
 * still be asked for; `permission` reports and requests it by itself.
 */
export function geolocation(
  app: AndroidApp,
): GeolocationPort & { permission: PermissionPort } {
  const manager = (): android.location.LocationManager =>
    app.context.getSystemService(android.content.Context.LOCATION_SERVICE);
  const permission = locationPermission(app);
  // GPS for a precise fix; otherwise whatever is cheapest and switched on.
  const provider = (options: GeoOptions): string => {
    const order = options.enableHighAccuracy
      ? ['gps', 'fused', 'network']
      : ['fused', 'network', 'gps'];
    const found = order.find((name) => {
      try {
        return manager().isProviderEnabled(name);
      } catch {
        return false; // a provider this device does not have
      }
    });
    if (!found) throw new Error('Location is switched off');
    return found;
  };
  const listenerFor = (
    receive: (location: android.location.Location) => void,
  ): android.location.LocationListener =>
    new android.location.LocationListener({
      // Android 12 and later deliver a batch; the runtime sends both forms
      // of the method to this one function.
      onLocationChanged(
        value:
          | android.location.Location
          | java.util.List<android.location.Location>,
      ) {
        if (value instanceof android.location.Location) return receive(value);
        for (let i = 0; i < value.size(); i++) receive(value.get(i));
      },
      onFlushComplete() {},
      onProviderEnabled() {},
      onProviderDisabled() {},
      onStatusChanged() {},
    });
  return {
    permission,
    async getCurrent(options) {
      await requirePermission(permission, 'Location');
      const source = provider(options);
      const known = manager().getLastKnownLocation(source);
      if (
        known &&
        options.maximumAge !== undefined &&
        Date.now() - known.getTime() <= options.maximumAge
      )
        return position(known);
      return new Promise<GeoPosition>((resolve, reject) => {
        let stop = (): void => {};
        // The timeout exists only while this request is open.
        const expired = new java.lang.Runnable({
          run() {
            stop();
            reject(new Error('Timed out waiting for a location'));
          },
        });
        const settle = (location: android.location.Location | null): void => {
          mainHandler().removeCallbacks(expired);
          stop();
          if (location) resolve(position(location));
          else reject(new Error('No location is available'));
        };
        if (sdk() >= 30) {
          const functions = (
            java.util as unknown as { function: JavaUtilFunction }
          ).function;
          const cancel = new android.os.CancellationSignal();
          stop = () => cancel.cancel();
          manager().getCurrentLocation(
            source,
            cancel,
            app.context.getMainExecutor(),
            new functions.Consumer<android.location.Location | null>({
              accept: settle,
            }),
          );
        } else {
          const listener = listenerFor(settle);
          stop = () => manager().removeUpdates(listener);
          manager().requestLocationUpdates(
            source,
            0,
            0,
            listener,
            android.os.Looper.getMainLooper(),
          );
        }
        if (options.timeout !== undefined && Number.isFinite(options.timeout))
          mainHandler().postDelayed(expired, options.timeout);
      });
    },
    watch(options, listener) {
      let registered: android.location.LocationListener | undefined;
      let stopped = false;
      void requirePermission(permission, 'Location').then(
        () => {
          if (stopped) return;
          registered = listenerFor((location) => listener(position(location)));
          manager().requestLocationUpdates(
            provider(options),
            1000,
            0,
            registered,
            android.os.Looper.getMainLooper(),
          );
        },
        () => {}, // refused: the watch stays silent, as `permission` reports
      );
      return () => {
        stopped = true;
        if (registered) manager().removeUpdates(registered);
        registered = undefined;
      };
    },
  };
}
