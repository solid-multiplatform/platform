import type { JSX } from 'solid-js';

/** Takes the free space of the `Row`, `Column` or `Screen` it is in. */
export function Spacer(): JSX.Element {
  return <view skipFocus width={0} height={0} flexGrow={1} />;
}
