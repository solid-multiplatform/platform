/**
 * The browser's location and motion services. Synchronous SDK functions use
 * both (`watchPosition`, `watchSensor`), so ./sensors.manifest.ts imports
 * them directly. Plain objects: importing this module runs nothing, and a
 * listener exists only between `watch` and the disposer it returns.
 */
import type { GeolocationPort, GeoPosition } from '../../sdk/geolocation.js';
import { CapabilityError } from '../../sdk/registry.js';
import type { SensorsPort, SensorType } from '../../sdk/sensors.js';

const fromWeb = (position: GeolocationPosition): GeoPosition => ({
  latitude: position.coords.latitude,
  longitude: position.coords.longitude,
  accuracy: position.coords.accuracy,
  altitude: position.coords.altitude ?? undefined,
  heading: position.coords.heading ?? undefined,
  speed: position.coords.speed ?? undefined,
  timestamp: position.timestamp,
});

// Absent on insecure origins and most TV browsers.
const locator = (): Geolocation => {
  const api = (navigator as { geolocation?: Geolocation }).geolocation;
  if (!api) throw new CapabilityError('geolocation');
  return api;
};

export const geolocation: GeolocationPort = {
  async getCurrent(options) {
    const api = locator();
    return new Promise((resolve, reject) => {
      api.getCurrentPosition(
        (position) => resolve(fromWeb(position)),
        (error) => reject(error),
        options,
      );
    });
  },
  watch(options, listener) {
    const api = locator();
    const id = api.watchPosition(
      (position) => listener(fromWeb(position)),
      () => undefined,
      options,
    );
    return () => api.clearWatch(id);
  },
};

const motion = (type: SensorType): boolean =>
  (type === 'accelerometer' || type === 'gyroscope') &&
  typeof DeviceMotionEvent !== 'undefined';

/** `devicemotion` for the accelerometer and gyroscope; nothing else. */
export const sensors: SensorsPort = {
  available: motion,
  watch(type, listener) {
    if (!motion(type)) throw new CapabilityError(`sensor.${type}`);
    const handler = (event: DeviceMotionEvent) => {
      if (type === 'accelerometer') {
        const source = event.accelerationIncludingGravity;
        if (!source) return;
        listener({
          sensor: type,
          x: source.x ?? undefined,
          y: source.y ?? undefined,
          z: source.z ?? undefined,
          timestamp: Date.now(),
        });
        return;
      }
      const source = event.rotationRate;
      if (!source) return;
      listener({
        sensor: type,
        x: source.alpha ?? undefined,
        y: source.beta ?? undefined,
        z: source.gamma ?? undefined,
        timestamp: Date.now(),
      });
    };
    window.addEventListener('devicemotion', handler);
    return () => window.removeEventListener('devicemotion', handler);
  },
};
