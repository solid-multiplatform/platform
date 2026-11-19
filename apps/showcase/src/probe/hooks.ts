/**
 * The nodes the probe's UI assertions look at. A screen sets its entry when
 * it mounts; nothing reads them outside a probe run.
 */
import type { ElementNode } from '@solid-multiplatform/platform';

export const probeHooks: {
  /** The virtual list of the list screen. */
  list?: ElementNode;
  /** The row of the list that has focus. */
  listIndex?: () => number;
  /** The button that opens the modal, and the modal while it is open. */
  modalOpener?: ElementNode;
  modal?: ElementNode;
  modalOpen?: () => boolean;
} = {};
