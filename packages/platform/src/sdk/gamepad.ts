export interface GamepadButtonState {
  pressed: boolean;
  value: number;
}

export interface GamepadSnapshot {
  index: number;
  id: string;
  mapping: string;
  axes: number[];
  buttons: readonly GamepadButtonState[];
}

export interface GamepadEdges {
  /** Button indexes that went down since the previous snapshot. */
  pressed: number[];
  /** Button indexes that went up since the previous snapshot. */
  released: number[];
}

const gamepads = (): readonly Gamepad[] => {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
  return Array.from(navigator.getGamepads()).filter(
    (pad): pad is Gamepad => pad !== null,
  );
};

/**
 * Snapshot every connected gamepad. Call this from the app's own input loop or
 * an event handler; it does not start a frame timer, so TV scenes stay idle.
 */
export function readGamepads(): GamepadSnapshot[] {
  return gamepads().map((pad) => ({
    index: pad.index,
    id: pad.id,
    mapping: pad.mapping,
    axes: [...pad.axes],
    buttons: pad.buttons.map((button) => ({
      pressed: button.pressed,
      value: button.value,
    })),
  }));
}

/** Button transitions between two snapshots for event-style handling. */
export function gamepadEdges(
  previous: GamepadSnapshot | undefined,
  next: GamepadSnapshot,
): GamepadEdges {
  const pressed: number[] = [];
  const released: number[] = [];
  next.buttons.forEach((button, index) => {
    const was = previous?.buttons[index]?.pressed ?? false;
    if (button.pressed && !was) pressed.push(index);
    if (!button.pressed && was) released.push(index);
  });
  return { pressed, released };
}

export interface GamepadEventHandlers {
  onConnect?(gamepad: GamepadSnapshot): void;
  onDisconnect?(gamepad: GamepadSnapshot): void;
}

/**
 * Subscribe to gamepad connect/disconnect. Pair with `readGamepads` and
 * `gamepadEdges` inside the existing input loop; no polling is scheduled here.
 */
export function bindGamepadEvents(
  handlers: GamepadEventHandlers,
  target: EventTarget | undefined = typeof window === 'undefined'
    ? undefined
    : window,
): () => void {
  const connect = (event: Event) => {
    const pad = (event as GamepadEvent).gamepad;
    if (!pad) return;
    handlers.onConnect?.({
      index: pad.index,
      id: pad.id,
      mapping: pad.mapping,
      axes: [...pad.axes],
      buttons: pad.buttons.map((button) => ({
        pressed: button.pressed,
        value: button.value,
      })),
    });
  };
  const disconnect = (event: Event) => {
    const pad = (event as GamepadEvent).gamepad;
    if (!pad) return;
    handlers.onDisconnect?.({
      index: pad.index,
      id: pad.id,
      mapping: pad.mapping,
      axes: [],
      buttons: [],
    });
  };
  target?.addEventListener('gamepadconnected', connect);
  target?.addEventListener('gamepaddisconnected', disconnect);
  return () => {
    target?.removeEventListener('gamepadconnected', connect);
    target?.removeEventListener('gamepaddisconnected', disconnect);
  };
}
