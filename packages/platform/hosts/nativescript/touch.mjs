import { Application } from '@nativescript/core';
import { createInputScope } from '@solid-multiplatform/platform/input';
/** The OS owns pointer identity. Cancellation also clears long-press deadlines. */
export function bindSceneTouch(canvas, target) {
  const scope = createInputScope();
  const touch = (e) => {
    if (e.action === 'cancel') {
      scope.cancelAll();
      return;
    }
    if (target === 'android') {
      const event = e.android,
        action = event.getActionMasked();
      const scale = canvas.android.getResources().getDisplayMetrics().density;
      const index = event.getActionIndex();
      for (let i = 0; i < event.getPointerCount(); i++) {
        if (action !== 2 && i !== index) continue;
        const id = event.getPointerId(i),
          point = { x: event.getX(i) / scale, y: event.getY(i) / scale };
        if (action === 0 || action === 5) scope.down(id, point);
        else if (action === 2) scope.move(id, point, false);
        else if (action === 1 || action === 6) scope.up(id, point);
      }
    } else {
      // NativeScript reports the changed UIKit touches in ios.touches.
      const touches = e.ios?.touches;
      if (!touches) return;
      for (let i = 0, list = touches.allObjects; i < list.count; i++) {
        const t = list.objectAtIndex(i);
        const id = t.hash,
          loc = t.locationInView(canvas.ios),
          point = { x: loc.x, y: loc.y };
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
