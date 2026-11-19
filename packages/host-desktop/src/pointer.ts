// Pointers: the runtime's mouse, touch, pen and wheel events as the
// platform's `PointerSource`. The host only says where a pointer is, in
// scene units; the framework finds the node under it and tells a click from
// a hold or a drag (`createScenePointer`).
//
// This file is the whole of the desktop's pointer delivery.
import type {
  PointerSink,
  PointerSource,
} from '@solid-multiplatform/platform/input';
import { onNative } from './events.js';

/**
 * Feeds `sink` until the returned function is called. Only the primary
 * button presses, as in the web host; hover is for pointers that can hover.
 */
function feedPointers(sink: PointerSink): () => void {
  const stops = [
    onNative('pointerdown', (e) => {
      if (e.button === 0) sink.down(e.pointerId, e);
      // The window system's secondary button: the scene's context menu.
      else if (e.button === 2) sink.context?.(e);
    }),
    onNative('pointermove', (e) =>
      sink.move(e.pointerId, e, e.pointerType !== 'touch'),
    ),
    onNative('pointerup', (e) => {
      if (e.button === 0) sink.up(e.pointerId, e);
    }),
    onNative('pointercancel', (e) => sink.cancel(e.pointerId)),
    onNative('pointerleave', () => sink.leave()),
    onNative('wheel', (e) => sink.wheel(e, e.deltaX, e.deltaY)),
    // A press does not outlive the window's focus: its release may never
    // arrive.
    onNative('blur', () => sink.cancelAll()),
  ];
  return () => {
    for (const stop of stops) stop();
    sink.cancelAll();
  };
}

/**
 * The window's pointers. Nothing is listened for until an app is mounted
 * with it. The runtime has no cursor shapes yet, so there is no `setCursor`.
 */
export function desktopPointers(): PointerSource {
  return { connect: feedPointers };
}
