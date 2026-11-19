import type { ElementText, TextNode } from '../core/index.js';
import { Config, ElementNode, rootNode } from '../index.js';
import { resetCursor, setCursor } from '../sdk/cursor.js';
import { createScenePointer, hasScenePointer } from '../sdk/input.js';
import { createSignal, onCleanup } from 'solid-js';

type CustomState = `$${string}`;

type RenderableNode = ElementNode | ElementText | TextNode;

interface MouseStateOptions {
  hoverState: CustomState;
  pressedState: CustomState;
}

type UseMouseOptions =
  | { customStates: MouseStateOptions }
  | { customStates: undefined };

export function addCustomStateToElement(
  element: RenderableNode,
  state: CustomState,
): void {
  (element as ElementNode).states?.add(state);
}

export function removeCustomStateFromElement(
  element: RenderableNode,
  state: CustomState,
): void {
  (element as ElementNode)?.states?.remove(state);
}

export function hasCustomState(
  element: RenderableNode,
  state: CustomState,
): boolean {
  return (element as ElementNode).states?.has(state);
}

const [cursorVisible, setCursorVisible] = createSignal(false);

let listening = false;

// webOS dispatches `cursorStateChange` on `document` whenever the Magic Remote
// pointer appears or disappears; `detail.visibility` is the new state.
const handleCursorStateChange = (event: Event) => {
  setCursorVisible(
    Boolean(
      (event as CustomEvent<{ visibility?: boolean }>).detail?.visibility,
    ),
  );
};

// A single, app-lifetime listener backs every caller so a page full of rails
// does not attach one listener per rail. Attached lazily on first read.
const ensureListening = () => {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener(
    'cursorStateChange',
    handleCursorStateChange,
    false,
  );
};

/**
 * Reactive accessor for webOS Magic Remote cursor visibility. `true` while the
 * pointer is on screen, `false` otherwise.
 */
export const isCursorVisible = () => {
  ensureListening();
  return cursorVisible();
};

/**
 * Mouse input for a web app that starts with `createRenderer`. An app started
 * with `startApp` has its host's pointer connected already and must not call
 * this; where it finds the scene's pointer in place it does nothing.
 *
 * It feeds the window's mouse and wheel events to the scene's one pointer
 * path (`createScenePointer`), which finds the node under the mouse and
 * handles hover, press, click and scroll: see `sdk/input.ts` for the rules.
 * Without `customStates` the hovered element is focused, as a pointer remote
 * does on a TV; with them it gets the hover state instead and a click
 * focuses.
 *
 * @param myApp The node whose tree takes the mouse.
 * @param _throttleBy No longer used: the hit test runs per mouse event.
 */
export function useMouse<TApp extends ElementNode = ElementNode>(
  myApp: TApp = rootNode as TApp,
  _throttleBy: number = 100,
  options?: UseMouseOptions,
): void {
  if (hasScenePointer(myApp) || hasScenePointer(rootNode)) return;
  const states = options?.customStates;
  const pointer = createScenePointer(myApp, {
    hoverState: states?.hoverState,
    pressedState: states?.pressedState,
    hoverFocus: !states,
    cursor: (style) => (style === undefined ? resetCursor() : setCursor(style)),
  });
  // One point for every event: the scene reads it and keeps nothing.
  const point = { x: 0, y: 0 };
  const at = (e: MouseEvent) => {
    const precision = Config.rendererOptions?.deviceLogicalPixelRatio || 1;
    point.x = e.clientX / precision;
    point.y = e.clientY / precision;
    return point;
  };
  const down = (e: MouseEvent) => {
    if (e.button === 0) pointer.down(1, at(e));
  };
  const move = (e: MouseEvent) => pointer.move(1, at(e));
  const up = (e: MouseEvent) => {
    if (e.button === 0) pointer.up(1, at(e));
  };
  const wheel = (e: WheelEvent) => {
    pointer.wheel(at(e), e.deltaX, e.deltaY);
  };
  window.addEventListener('mousedown', down);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  window.addEventListener('wheel', wheel);
  onCleanup(() => {
    window.removeEventListener('mousedown', down);
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    window.removeEventListener('wheel', wheel);
    pointer.dispose();
  });
}
