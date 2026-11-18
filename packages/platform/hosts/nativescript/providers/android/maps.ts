import type {
  DirectionsMode,
  MapCoordinate,
  MapsPort,
} from '../../../../src/sdk/maps.js';
import { CapabilityError } from '@solid-multiplatform/platform/services';
import { activityOf, type AndroidApp } from './runtime.js';

const place = (value: MapCoordinate | string): string =>
  typeof value === 'string' ? value : `${value.latitude},${value.longitude}`;

// google.navigation has no transit mode.
const NAVIGATION: Partial<Record<DirectionsMode, string>> = {
  driving: 'd',
  walking: 'w',
  bicycling: 'b',
};

/**
 * The device's map app, through `geo:` and `google.navigation:` addresses.
 * Turn-by-turn navigation starts from where the user is, so directions with
 * an origin, or by transit, open the route in the map app from its web
 * address instead. Phone only.
 */
export function maps(app: AndroidApp): MapsPort {
  const view = (capability: string, address: string): void => {
    try {
      activityOf(app).startActivity(
        new android.content.Intent(
          android.content.Intent.ACTION_VIEW,
          android.net.Uri.parse(address),
        ),
      );
    } catch (error) {
      if (
        (error as { nativeException?: unknown }).nativeException instanceof
        android.content.ActivityNotFoundException
      )
        throw new CapabilityError(capability);
      throw error;
    }
  };
  return {
    async open(options) {
      const marker = options.markers?.[0];
      const centre = options.center ?? marker;
      const label = options.label ?? marker?.title;
      const zoom = options.zoom === undefined ? '' : `z=${options.zoom}`;
      const pin = marker
        ? `q=${place(marker)}${label ? encodeURIComponent(`(${label})`) : ''}`
        : label
          ? `q=${encodeURIComponent(label)}`
          : '';
      view(
        'maps.open',
        `geo:${centre ? place(centre) : '0,0'}?${[zoom, pin].filter(Boolean).join('&')}`,
      );
    },
    async directions(options) {
      const mode = NAVIGATION[options.mode ?? 'driving'];
      if (!options.origin && mode)
        return view(
          'maps.directions',
          `google.navigation:q=${encodeURIComponent(place(options.destination))}&mode=${mode}`,
        );
      const query = [
        'api=1',
        'destination=' + encodeURIComponent(place(options.destination)),
        options.origin
          ? 'origin=' + encodeURIComponent(place(options.origin))
          : '',
        options.mode ? 'travelmode=' + options.mode : '',
      ];
      view(
        'maps.directions',
        'https://www.google.com/maps/dir/?' + query.filter(Boolean).join('&'),
      );
    },
  };
}
