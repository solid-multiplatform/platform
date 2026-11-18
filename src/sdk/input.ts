export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface InputControl {
  bounds(): Rect;
  disabled?(): boolean;
  focus?(): void;
  hover?(active: boolean): void;
  pressed?(active: boolean): void;
  activate?(): void;
  hold?(): void;
  drag?(
    phase: 'start' | 'move' | 'end' | 'cancel',
    point: Point,
    origin: Point,
  ): void;
  scroll?(x: number, y: number): void;
}
interface Press {
  control: InputControl;
  origin: Point;
  point: Point;
  held: boolean;
  dragged: boolean;
  timer?: ReturnType<typeof setTimeout>;
}
export function createInputScope(
  options: { holdMs?: number; slop?: number } = {},
) {
  const controls = new Set<InputControl>();
  const presses = new Map<number, Press>();
  let hovered: InputControl | undefined;
  let focused: InputControl | undefined;
  let keyHeld: 'Enter' | ' ' | undefined;
  const keyboard = -1;
  const hit = (point: Point) => {
    let match: InputControl | undefined;
    for (const c of controls) {
      if (c.disabled?.()) continue;
      const b = c.bounds();
      if (
        point.x >= b.x &&
        point.y >= b.y &&
        point.x < b.x + b.width &&
        point.y < b.y + b.height
      )
        match = c;
    }
    return match;
  };
  function focus(c: InputControl | undefined) {
    if (c && controls.has(c) && !c.disabled?.()) {
      focused = c;
      c.focus?.();
    }
  }
  function hover(c?: InputControl) {
    if (hovered !== c) {
      hovered?.hover?.(false);
      hovered = c;
      c?.hover?.(true);
    }
  }
  function cancel(id: number) {
    const p = presses.get(id);
    if (!p) return;
    presses.delete(id);
    clearTimeout(p.timer);
    p.control.pressed?.(false);
    if (p.dragged) p.control.drag?.('cancel', p.point, p.origin);
    if (id === keyboard) keyHeld = undefined;
  }
  function begin(id: number, c: InputControl, point: Point) {
    cancel(id);
    const p: Press = {
      control: c,
      origin: point,
      point,
      held: false,
      dragged: false,
    };
    presses.set(id, p);
    focus(c);
    c.pressed?.(true);
    if (c.hold)
      p.timer = setTimeout(() => {
        if (c.disabled?.()) {
          cancel(id);
          return;
        }
        p.held = true;
        c.hold?.();
      }, options.holdMs ?? 550);
  }
  function finish(id: number, point: Point, inside: boolean) {
    const p = presses.get(id);
    if (!p) return;
    presses.delete(id);
    clearTimeout(p.timer);
    p.control.pressed?.(false);
    if (p.dragged) p.control.drag?.('end', point, p.origin);
    else if (!p.held && inside && !p.control.disabled?.())
      p.control.activate?.();
  }
  function cancelAll() {
    for (const id of presses.keys()) cancel(id);
    hover();
  }
  return {
    register(c: InputControl) {
      controls.add(c);
      return () => {
        controls.delete(c);
        for (const [id, p] of presses) if (p.control === c) cancel(id);
        if (hovered === c) hover();
        if (focused === c) focused = undefined;
      };
    },
    focus,
    down(id: number, point: Point) {
      const c = hit(point);
      if (c) begin(id, c, point);
      return !!c;
    },
    move(id: number, point: Point, canHover = true) {
      const p = presses.get(id);
      if (!p) {
        if (canHover) hover(hit(point));
        return;
      }
      p.point = point;
      if (p.control.disabled?.()) {
        cancel(id);
        return;
      }
      if (
        !p.dragged &&
        !p.held &&
        Math.hypot(point.x - p.origin.x, point.y - p.origin.y) >
          (options.slop ?? 8)
      ) {
        clearTimeout(p.timer);
        p.dragged = true;
        p.control.drag?.('start', point, p.origin);
      }
      if (p.dragged) p.control.drag?.('move', point, p.origin);
    },
    up(id: number, point: Point) {
      const p = presses.get(id);
      if (p) finish(id, point, hit(point) === p.control);
    },
    leave() {
      hover();
    },
    cancel,
    cancelAll,
    wheel(point: Point, x: number, y: number) {
      const c = hit(point);
      if (!c?.scroll) return false;
      c.scroll(x, y);
      return true;
    },
    key(key: string, down: boolean, repeat = false, shift = false) {
      if (key === 'Tab' && down) {
        const list = [...controls].filter((c) => !c.disabled?.());
        if (!list.length) return false;
        const i = focused ? list.indexOf(focused) : -1;
        focus(
          list[
            i < 0
              ? shift
                ? list.length - 1
                : 0
              : (i + (shift ? -1 : 1) + list.length) % list.length
          ],
        );
        return true;
      }
      if (key !== 'Enter' && key !== ' ') return false;
      if (down && focused && !focused.disabled?.()) {
        if (!repeat && !keyHeld) {
          begin(keyboard, focused, { x: 0, y: 0 });
          keyHeld = key;
        }
        return true;
      }
      if (!down && keyHeld === key) {
        keyHeld = undefined;
        finish(keyboard, { x: 0, y: 0 }, true);
        return true;
      }
      return false;
    },
    dispose() {
      cancelAll();
      controls.clear();
      focused = undefined;
    },
  };
}
export type InputScope = ReturnType<typeof createInputScope>;
/** Coordinates are converted to logical scene units before hit testing or capture. */
export function bindPointerEvents(
  element: HTMLElement,
  scope: InputScope,
  project: (x: number, y: number) => Point,
) {
  const events = new AbortController();
  const opts = { signal: events.signal };
  element.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      if (scope.down(e.pointerId, project(e.clientX, e.clientY))) {
        element.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    },
    opts,
  );
  element.addEventListener(
    'pointermove',
    (e) =>
      scope.move(
        e.pointerId,
        project(e.clientX, e.clientY),
        e.pointerType !== 'touch',
      ),
    opts,
  );
  element.addEventListener(
    'pointerup',
    (e) => scope.up(e.pointerId, project(e.clientX, e.clientY)),
    opts,
  );
  element.addEventListener(
    'pointercancel',
    (e) => scope.cancel(e.pointerId),
    opts,
  );
  element.addEventListener(
    'lostpointercapture',
    (e) => scope.cancel(e.pointerId),
    opts,
  );
  element.addEventListener('pointerleave', () => scope.leave(), opts);
  element.addEventListener(
    'wheel',
    (e) => {
      const unit =
        e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? element.clientHeight : 1;
      if (
        scope.wheel(
          project(e.clientX, e.clientY),
          e.deltaX * unit,
          e.deltaY * unit,
        )
      )
        e.preventDefault();
    },
    { ...opts, passive: false },
  );
  window.addEventListener('blur', scope.cancelAll, opts);
  return () => {
    events.abort();
    scope.cancelAll();
  };
}
