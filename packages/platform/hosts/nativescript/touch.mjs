import { Application } from '@nativescript/core';
import { createInputScope } from '@solid-multiplatform/platform/input';
/** The OS owns pointer identity. Cancellation also clears long-press deadlines. */
export function bindSceneTouch(canvas, target) {
  const scope = createInputScope();
  // One scratch point per handler run: the sink parks its arguments before
  // dispatching, so a reused object allocates nothing per touch event.
  const point = { x: 0, y: 0 };
  // One JNI read per session, not one per touch event.
  let density = 0;
  const touch = (e) => {
    if (e.action === 'cancel') {
      scope.cancelAll();
      return;
    }
    if (target === 'android') {
      const event = e.android,
        action = event.getActionMasked();
      const index = event.getActionIndex();
      if (!density) {
        density = canvas.android.getResources().getDisplayMetrics().density;
      }
      for (let i = 0; i < event.getPointerCount(); i++) {
        if (action !== 2 && i !== index) continue;
        const id = event.getPointerId(i);
        // A frame that overran coalesces the samples since the last event
        // into history. Dropping them loses a segment of the finger's path:
        // one event then applies a doubled delta and the release velocity
        // spikes. Replay every sample in order, history first.
        const history = event.getHistorySize();
        for (let h = 0; h < history; h++) {
          point.x = event.getHistoricalX(i, h) / density;
          point.y = event.getHistoricalY(i, h) / density;
          scope.move(id, point, false);
        }
        point.x = event.getX(i) / density;
        point.y = event.getY(i) / density;
        if (action === 0 || action === 5) scope.down(id, point);
        else if (action === 2) scope.move(id, point, false);
        else if (action === 1 || action === 6) scope.up(id, point);
      }
    } else {
      // NativeScript reports the changed UIKit touches in ios.touches; each
      // event carries the current sample, so there is no history to replay.
      const touches = e.ios?.touches;
      if (!touches) return;
      for (let i = 0, list = touches.allObjects; i < list.count; i++) {
        const t = list.objectAtIndex(i);
        const id = t.hash,
          loc = t.locationInView(canvas.ios);
        point.x = loc.x;
        point.y = loc.y;
        if (e.action === 'down') scope.down(id, point);
        else if (e.action === 'move') scope.move(id, point, false);
        else scope.up(id, point);
      }
    }
  };
  canvas.on('touch', touch);
  Application.on('suspend', scope.cancelAll);
  return {
    input: scope,
    dispose() {
      canvas.off('touch', touch);
      Application.off('suspend', scope.cancelAll);
      scope.dispose();
    },
  };
}
