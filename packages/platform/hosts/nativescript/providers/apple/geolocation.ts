import type {
  GeoOptions,
  GeoPosition,
  GeolocationPort,
} from '@solid-multiplatform/platform/geolocation';

const kCLAuthorizationStatusNotDetermined = 0;

function position(location: CLLocation): GeoPosition {
  return {
    latitude: location.coordinate.latitude,
    longitude: location.coordinate.longitude,
    accuracy: location.horizontalAccuracy,
    // Core Location marks an unknown value with a negative one.
    altitude: location.verticalAccuracy >= 0 ? location.altitude : undefined,
    heading: location.course >= 0 ? location.course : undefined,
    speed: location.speed >= 0 ? location.speed : undefined,
    timestamp: location.timestamp.getTime(),
  };
}

interface Session {
  stop(): void;
}

/** What each delegate instance reports to. */
interface Receiver {
  found?: (position: GeoPosition) => void;
  failed?: (error: Error) => void;
}

interface DelegateMethods extends Receiver {
  locationManagerDidUpdateLocations(
    manager: CLLocationManager,
    locations: NSArray<CLLocation>,
  ): void;
  locationManagerDidFailWithError(
    manager: CLLocationManager,
    error: NSError,
  ): void;
}

// The Objective-C class is defined once, on the first request.
let Delegate: (new () => NSObject & DelegateMethods) | undefined;

/**
 * One `CLLocationManager` and its delegate per request or watch, released
 * when it ends: nothing listens for location in between. The app must
 * declare `NSLocationWhenInUseUsageDescription`.
 */
function start(
  options: GeoOptions,
  continuous: boolean,
  found: (position: GeoPosition) => void,
  failed: (error: Error) => void,
): Session {
  Delegate ??= NSObject.extend<DelegateMethods>(
    {
      locationManagerDidUpdateLocations(_manager, locations) {
        const latest = locations.lastObject;
        if (latest) this.found?.(position(latest));
      },
      locationManagerDidFailWithError(_manager, error) {
        this.failed?.(new Error(error.localizedDescription));
      },
    },
    { protocols: [CLLocationManagerDelegate] },
  );
  const manager = CLLocationManager.new();
  // The manager does not retain its delegate: this closure does.
  const delegate = new Delegate();
  delegate.found = found;
  delegate.failed = failed;
  manager.delegate = delegate as unknown as CLLocationManagerDelegate;
  manager.desiredAccuracy = options.enableHighAccuracy
    ? kCLLocationAccuracyBest
    : kCLLocationAccuracyHundredMeters;
  if (manager.authorizationStatus === kCLAuthorizationStatusNotDetermined)
    manager.requestWhenInUseAuthorization();
  if (continuous) manager.startUpdatingLocation();
  else manager.requestLocation();
  return {
    stop() {
      manager.stopUpdatingLocation();
      manager.delegate = null as unknown as CLLocationManagerDelegate;
      delegate.found = delegate.failed = undefined;
    },
  };
}

/** iOS only: tvOS has one-shot requests but no continuous updates to watch. */
export function geolocation(): GeolocationPort {
  return {
    getCurrent: (options) =>
      new Promise((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (settle: () => void) => {
          if (timer !== undefined) clearTimeout(timer);
          session.stop();
          settle();
        };
        const session = start(
          options,
          false,
          (found) => finish(() => resolve(found)),
          (error) => finish(() => reject(error)),
        );
        if (options.timeout !== undefined)
          timer = setTimeout(
            () => finish(() => reject(new Error('Location timed out'))),
            options.timeout,
          );
      }),
    watch(options, listener) {
      // A failed fix is not the end of a watch: the next update may succeed.
      const session = start(options, true, listener, () => {});
      return () => session.stop();
    },
  };
}
