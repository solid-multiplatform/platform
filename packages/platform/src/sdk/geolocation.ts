import { CapabilityError } from './services.js';

export interface GeoPosition {
  latitude: number;
  longitude: number;
  /** Metres. */
  accuracy: number;
  altitude?: number;
  heading?: number;
  speed?: number;
  /** Unix milliseconds. */
  timestamp: number;
}

export interface GeoOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

export interface GeolocationPort {
  getCurrent(options: GeoOptions): Promise<GeoPosition>;
  watch(
    options: GeoOptions,
    listener: (position: GeoPosition) => void,
  ): () => void;
}

let port: GeolocationPort | undefined;

export function setGeolocationPort(next: GeolocationPort | undefined): void {
  port = next;
}

const fromWeb = (position: GeolocationPosition): GeoPosition => ({
  latitude: position.coords.latitude,
  longitude: position.coords.longitude,
  accuracy: position.coords.accuracy,
  altitude: position.coords.altitude ?? undefined,
  heading: position.coords.heading ?? undefined,
  speed: position.coords.speed ?? undefined,
  timestamp: position.timestamp,
});

const webGeolocation = (): Geolocation | undefined => {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.geolocation;
};

/** Current location through the host port or the browser Geolocation API. */
export function getCurrentPosition(
  options: GeoOptions = {},
): Promise<GeoPosition> {
  if (port) return port.getCurrent(options);
  const web = webGeolocation();
  if (!web) throw new CapabilityError('geolocation');
  return new Promise((resolve, reject) => {
    web.getCurrentPosition(
      (position) => resolve(fromWeb(position)),
      (error) => reject(error),
      options,
    );
  });
}

/**
 * Watch location changes. Returns a disposer; call it when the screen exits
 * so the host can stop the GPS/network provider.
 */
export function watchPosition(
  options: GeoOptions,
  listener: (position: GeoPosition) => void,
): () => void {
  if (port) return port.watch(options, listener);
  const web = webGeolocation();
  if (!web) throw new CapabilityError('geolocation');
  const id = web.watchPosition(
    (position) => listener(fromWeb(position)),
    () => undefined,
    options,
  );
  return () => web.clearWatch(id);
}
