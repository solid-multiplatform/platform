// Pointers: the runtime's mouse, touch, pen and wheel events fed into the
// platform's `InputScope`, which hit-tests them against the controls the app
// registered.
//
// This file is the whole of the desktop's pointer delivery. The events it
// reads are already what a low-level pointer source carries (an id, a type,
// a position in scene units, buttons), so pointing them at a different
// consumer changes only the body of `feedPointers`.
import type { InputScope } from '@solid-multiplatform/platform/input';
import { onNative } from './events.js';

/**
 * Feeds `scope` until the returned function is called. Only the primary
 * button presses, as in the web host; hover is for pointers that can hover.
 */
export function feedPointers(scope: InputScope): () => void {
  const stops = [
    onNative('pointerdown', (e) => {
      if (e.button === 0) scope.down(e.pointerId, e);
    }),
    onNative('pointermove', (e) =>
      scope.move(e.pointerId, e, e.pointerType !== 'touch'),
    ),
    onNative('pointerup', (e) => {
      if (e.button === 0) scope.up(e.pointerId, e);
    }),
    onNative('pointercancel', (e) => scope.cancel(e.pointerId)),
    onNative('pointerleave', () => scope.leave()),
    onNative('wheel', (e) => scope.wheel(e, e.deltaX, e.deltaY)),
    // A press does not outlive the window's focus: its release may never
    // arrive.
    onNative('blur', () => scope.cancelAll()),
  ];
  return () => {
    for (const stop of stops) stop();
    scope.cancelAll();
  };
}
