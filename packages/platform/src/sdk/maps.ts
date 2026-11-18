import { openExternal } from './device.js';
import { serviceAvailable, withService } from './registry.js';

export interface MapCoordinate {
  latitude: number;
  longitude: number;
}

export interface MapMarker extends MapCoordinate {
  id?: string;
  title?: string;
}

export interface MapOptions {
  center?: MapCoordinate;
  markers?: readonly MapMarker[];
  /** 1–20, host-defined. */
  zoom?: number;
  label?: string;
}

export type DirectionsMode = 'driving' | 'walking' | 'bicycling' | 'transit';

export interface DirectionsOptions {
  origin?: MapCoordinate | string;
  destination: MapCoordinate | string;
  mode?: DirectionsMode;
}

export interface MapsPort {
  open(options: MapOptions): Promise<void>;
  directions(options: DirectionsOptions): Promise<void>;
}

declare module './registry.js' {
  interface ServiceProviders {
    maps: MapsPort;
  }
}

export function mapsAvailable(): boolean {
  return serviceAvailable('maps') === 'available';
}

const coordinate = (value: MapCoordinate | string): string =>
  typeof value === 'string' ? value : `${value.latitude},${value.longitude}`;

const queryUrl = (options: MapOptions): string => {
  const markers = options.markers ?? [];
  const target =
    markers.length === 1
      ? `${markers[0]!.latitude},${markers[0]!.longitude}`
      : options.center
        ? coordinate(options.center)
        : markers.length
          ? `${markers[0]!.latitude},${markers[0]!.longitude}`
          : '';
  const params = new URLSearchParams({ api: '1' });
  if (target) params.set('query', target);
  if (options.zoom !== undefined) params.set('zoom', String(options.zoom));
  return `https://www.google.com/maps/search/?${params.toString()}`;
};

const directionsUrl = (options: DirectionsOptions): string => {
  const params = new URLSearchParams({
    api: '1',
    destination: coordinate(options.destination),
  });
  if (options.origin) params.set('origin', coordinate(options.origin));
  if (options.mode) params.set('travelmode', options.mode);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
};

/**
 * Open the platform map centred on a place. A host without a `maps` service
 * gets a Google Maps link through `openExternal`.
 */
export async function openMap(options: MapOptions): Promise<void> {
  if (mapsAvailable()) return withService('maps', (port) => port.open(options));
  await openExternal(queryUrl(options));
}

/** Open turn-by-turn directions in the platform map. */
export async function openDirections(
  options: DirectionsOptions,
): Promise<void> {
  if (mapsAvailable())
    return withService('maps', (port) => port.directions(options));
  await openExternal(directionsUrl(options));
}
