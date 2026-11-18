import { useService, withService } from './registry.js';

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

declare module './registry.js' {
  interface ServiceProviders {
    geolocation: GeolocationPort;
  }
}

/** Current location through the host's `geolocation` service. */
export async function getCurrentPosition(
  options: GeoOptions = {},
): Promise<GeoPosition> {
  return withService('geolocation', (port) => port.getCurrent(options));
}

/**
 * Watch location changes. Returns a disposer; call it when the screen exits
 * so the host can stop the GPS/network provider.
 */
export function watchPosition(
  options: GeoOptions,
  listener: (position: GeoPosition) => void,
): () => void {
  return useService('geolocation').watch(options, listener);
}
