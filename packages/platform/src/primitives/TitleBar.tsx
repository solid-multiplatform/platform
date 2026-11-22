import {
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  splitProps,
  useContext,
  type JSX,
} from 'solid-js';
import {
  clearChromeRegions,
  onChromeStateChange,
  setChromeRegions,
  type ChromeRegion,
  type WindowChrome,
  type WindowChromeState,
} from '../sdk/chrome.js';
import { viewport, setChromeInset } from '../sdk/viewport.js';
import { useTheme } from '../sdk/theme.jsx';
import { HostScope } from '../app/context.js';
import { isDev } from '../core/env.js';
import { isElementNode } from '../core/utils.js';
import type { ElementNode, NodeProps } from '../index.js';
import { chainFunctions } from './utils/chainFunctions.js';

/**
 * A region of the scene, in scene units, as the hit test sees it: the node's
 * own rectangle with its ancestors' positions added up. A scaled or rotated
 * ancestor is not supported — title bars and drag regions sit at the root.
 */
function sceneRect(node: ElementNode): ChromeRegion | undefined {
  let x = 0;
  let y = 0;
  let current: ElementNode | undefined = node;
  while (current !== undefined) {
    x += current.x ?? 0;
    y += current.y ?? 0;
    current = current.parent as ElementNode | undefined;
  }
  const width = node.width;
  const height = node.height;
  if (![x, y, width, height].every(Number.isFinite)) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height, drag: false };
}

/** Interactive is what the scene's pointer treats as interactive: a node
 * with an `onEnter` (a button, a field, a link) or an `onMouseClick`. */
function isInteractive(node: ElementNode): boolean {
  // The same target test the pointer uses: an interactive child may only
  // have a context-menu, drag, hold or hover handler, or a cursor, and still
  // must not become a window-drag area.
  const candidate = node as unknown as Record<string, unknown>;
  return (
    typeof candidate.onEnter === 'function' ||
    typeof candidate.onMouseClick === 'function' ||
    typeof candidate.onPointerContext === 'function' ||
    typeof candidate.onPointerDrag === 'function' ||
    typeof candidate.onPointerHold === 'function' ||
    typeof candidate.onPointerEnter === 'function' ||
    candidate.cursorStyle !== undefined
  );
}

/**
 * The interactive nodes inside `node`, in scene units. A press on one must
 * not start a window drag, so a drag region publishes each as a no-drag
 * hole: the framework's controls win over the drag region around them
 * without the app wrapping each one itself.
 */
function interactiveRects(node: ElementNode): ChromeRegion[] {
  const rects: ChromeRegion[] = [];
  const walk = (current: ElementNode): void => {
    for (const child of current.children) {
      if (!isElementNode(child)) continue;
      if (isInteractive(child)) {
        const rect = sceneRect(child);
        if (rect !== undefined) rects.push(rect);
      }
      walk(child);
    }
  };
  walk(node);
  return rects;
}

/**
 * The chrome primitives share one shape: a view that publishes its laid-out
 * rectangle to the host's hit test after every layout turn. `drag` decides
 * whether the rectangle drags the window or claims the press for a control
 * inside a drag region.
 */
function ChromeRegionView(props: NodeProps & { drag: boolean }): JSX.Element {
  const chrome = useContext(HostScope)?.chrome;
  if (chrome === undefined)
    throw new Error(
      props.drag
        ? '<WindowDragRegion> needs a host with window chrome (the desktop host)'
        : '<WindowNoDrag> needs a host with window chrome (the desktop host)',
    );
  // `splitProps`, never a spread of a destructured rest: the region follows
  // reactive x/y/width/height, or a resize leaves its measurements stale.
  const [local, rest] = splitProps(props, ['drag']);
  const owner = {};
  let node: ElementNode | undefined;
  const measure = (): void => {
    if (node === undefined || chrome.mode === 'native') return;
    const rect = sceneRect(node);
    if (rect === undefined) return;
    setChromeRegions(owner, [
      { ...rect, drag: local.drag },
      ...(local.drag ? interactiveRects(node) : []),
    ]);
  };
  // Once after this layout turn; the viewport changes the bar's size.
  const schedule = (): void => {
    queueMicrotask(measure);
  };
  createEffect(() => {
    void viewport();
    schedule();
  });
  onCleanup(() => clearChromeRegions(owner));
  return (
    <view
      {...rest}
      ref={node}
      onLayout={/* @once */ chainFunctions(rest.onLayout, schedule)}
    />
  );
}

export interface WindowDragRegionProps extends NodeProps {
  children?: JSX.Element;
}

/**
 * A part of the scene that drags the window when pressed. Inside another
 * drag region, a `WindowNoDrag` (or a framework control) keeps its own press:
 * the deeper region wins.
 *
 * Desktop only: a host without window chrome throws rather than silently
 * doing nothing.
 */
export function WindowDragRegion(props: WindowDragRegionProps): JSX.Element {
  return <ChromeRegionView {...props} drag={true} />;
}

export interface WindowNoDragProps extends NodeProps {
  children?: JSX.Element;
}

/** A control inside a drag region: pressing it never starts a window drag. */
export function WindowNoDrag(props: WindowNoDragProps): JSX.Element {
  return <ChromeRegionView {...props} drag={false} />;
}

/** The window state as a signal, updated only when the host reports an event. */
function useChromeState(chrome: WindowChrome): () => WindowChromeState {
  const [state, setState] = createSignal<WindowChromeState>(chrome.state());
  onMount(() => {
    setState(chrome.state());
    const stop = onChromeStateChange(() => setState(chrome.state()));
    onCleanup(stop);
  });
  return state;
}

export interface TitleBarProps {
  /** The window's title, drawn at the leading end. */
  title?: string;
  /** Content before the title (an icon, a menu). */
  leading?: JSX.Element;
  /** Content after the title, before the controls. */
  trailing?: JSX.Element;
  /**
   * `platform` (the default) draws minimize, maximize/restore and close in
   * `custom` mode; `none` draws only what the app passes. `hidden` never
   * draws the platform's controls.
   */
  controls?: 'platform' | 'none';
  /** Whether the bar's background drags the window. Default true. */
  drag?: boolean;
  /** The bar's height in scene units. Default 40. */
  height?: number;
}

const CONTROL_WIDTH = 36;

/**
 * The scene's title bar on a window whose mode is `custom` or `hidden`.
 *
 * Render it beside `<Screen>`, not inside it: the bar publishes its height as
 * `insets.systemBars.top` and `insets.safeArea.top`, and a `Screen` inside
 * the same column would count the inset twice. In fullscreen it renders
 * nothing and removes the inset; in `native` mode it renders nothing and
 * warns in development, because the window system already draws one.
 *
 * Its platform controls call the host's chrome: minimize, maximize/restore
 * (the button follows the events, never a local guess), and close through
 * the same disposal path as the window's close button.
 */
export function TitleBar(props: TitleBarProps): JSX.Element {
  const chrome = useContext(HostScope)?.chrome;
  if (chrome === undefined)
    throw new Error(
      '<TitleBar> needs a host with window chrome (the desktop host)',
    );
  const mode = chrome.mode;
  const theme = () => useTheme();
  const height = (): number => props.height ?? 40;
  const state = useChromeState(chrome);
  const fullscreen = (): boolean => state().fullscreen === true;
  const hidden = (): boolean => fullscreen();
  const shown = (): boolean => mode !== 'native' && !hidden();
  const width = (): number => viewport().width;
  // The inset follows the bar's height and fullscreen, not a frame.
  createEffect(() => setChromeInset(shown() ? height() : 0));
  onCleanup(() => setChromeInset(0));
  onMount(() => {
    if (mode === 'native' && isDev) {
      console.warn(
        '<TitleBar> is drawn, but the window is in native title bar mode: the window system draws one too. Set desktop.titleBar to "custom" in solid-platform.config.',
      );
    }
  });
  if (mode === 'native') return null;

  const controls = (): boolean =>
    mode === 'custom' && (props.controls ?? 'platform') === 'platform';
  const controlCount = (): number => (controls() ? 3 : 0);
  const leading = (): number => theme().spacing(2);
  const titleX = (): number =>
    leading() + (props.leading === undefined ? 0 : 24);
  const controlX = (index: number): number =>
    width() - (controlCount() - index) * CONTROL_WIDTH;

  /** One control: a no-drag area the pointer clicks and Enter presses. Its
   * icon is drawn with views, not glyphs: no font has to carry it. */
  const button = (
    x: () => number,
    action: () => void,
    description: () => string,
    icon: () => JSX.Element,
  ): JSX.Element => (
    <WindowNoDrag
      x={x()}
      y={0}
      width={CONTROL_WIDTH}
      height={height()}
      onMouseClick={action}
      onEnter={action}
      role="button"
      ariaLabel={description()}
    >
      {icon()}
    </WindowNoDrag>
  );

  const center = CONTROL_WIDTH / 2;
  const bar = (length: number, rotation = 0): JSX.Element => (
    <view
      skipFocus
      x={center - length / 2}
      y={height() / 2 - 1}
      width={length}
      height={2}
      rotation={rotation}
      color={theme().colors.text}
    />
  );
  const square = (offset: number): JSX.Element => (
    <view
      skipFocus
      x={center - 6 + offset}
      y={height() / 2 - 6 - offset}
      width={12}
      height={12}
      alpha={offset === 0 ? 1 : 0.6}
      style={{ border: { color: theme().colors.text, width: 2 } }}
    />
  );

  return (
    <Show when={shown()}>
      <view
        x={0}
        y={0}
        width={width()}
        height={height()}
        color={theme().colors.surface}
      >
        <Show when={props.drag !== false}>
          <WindowDragRegion x={0} y={0} width={width()} height={height()}>
            <Show when={props.leading !== undefined}>
              <view x={leading()} y={0} width={24} height={height()}>
                {props.leading}
              </view>
            </Show>
            <Show when={props.title !== undefined}>
              <text
                x={titleX()}
                y={height() / 2 - 12}
                width={Math.max(
                  0,
                  width() - titleX() - CONTROL_WIDTH * controlCount() - 8,
                )}
                height={24}
                fontSize={theme().typography.label}
                color={theme().colors.text}
              >
                {props.title}
              </text>
            </Show>
            <Show when={props.trailing !== undefined}>
              <view
                x={
                  width() -
                  CONTROL_WIDTH * controlCount() -
                  8 -
                  (props.trailing === undefined ? 0 : 80)
                }
                y={0}
                width={80}
                height={height()}
              >
                {props.trailing}
              </view>
            </Show>
          </WindowDragRegion>
        </Show>
        <Show when={controls()}>
          {button(
            () => controlX(0),
            () => void chrome.minimize(),
            () => 'Minimize',
            () => bar(12),
          )}
          {button(
            () => controlX(1),
            () => void chrome.toggleMaximized(),
            () => (state().maximized ? 'Restore' : 'Maximize'),
            // Two overlapping squares once maximized: the restore glyph.
            () =>
              state().maximized ? (
                <>
                  {square(3)}
                  {square(0)}
                </>
              ) : (
                square(0)
              ),
          )}
          {button(
            () => controlX(2),
            () => chrome.requestClose(),
            () => 'Close',
            () => (
              <>
                {bar(14, Math.PI / 4)}
                {bar(14, -Math.PI / 4)}
              </>
            ),
          )}
        </Show>
      </view>
    </Show>
  );
}

export type { WindowChrome, WindowChromeState, ChromeRegion };
