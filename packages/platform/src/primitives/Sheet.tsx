import { createSignal, Show, type JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import type { ForwardFocusHandler } from '../core/focusKeyTypes.js';
import { isElementNode } from '../core/utils.js';
import { Config } from '../core/config.js';
import { supports } from '../sdk/capabilities.js';
import { useUiScale } from '../sdk/layout.js';
import { useTheme } from '../sdk/theme.jsx';
import { viewport } from '../sdk/viewport.js';
import { overlayEnter, overlayExit, sheetEasing } from './FadeInOut.jsx';
import { Modal } from './Modal.jsx';

// UISheetPresentationController: the panel rises in from its resting edge and
// slides back out on dismiss. The iOS sheet curve (swiftui-motion.md), as a
// function so every backend runs the same curve. The entrance starts fully
// transparent and stays that way for its first stretch (see
// OverlayMotion.fadeDelay): the panel is genuinely off screen while it
// travels, and an audit of the resting layout must not read the half-arrived
// panel as cut off.
const SHEET_MOTION = { duration: 320, easing: sheetEasing, fadeDelay: 80 };
const SHEET_EXIT_MOTION = { duration: 300, easing: sheetEasing } as const;

// Focus on the sheet goes to the first of the app's children that takes it
// (the panel's second child holds them); with none that view keeps it.
const focusContent: ForwardFocusHandler = function () {
  const children = this.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (isElementNode(child) && !child.skipFocus) {
      child.setFocus();
      return true;
    }
  }
  return false;
};

export interface SheetProps {
  visible: boolean | (() => boolean);
  onRequestClose?(): void;
  /** Accessible name, also used as the default title. */
  label: string;
  title?: string;
  /** Height in logical units; defaults to 60% of the window (max 640). */
  height?: number;
  /** Keep the panel above the software keyboard. Defaults to true. */
  avoidKeyboard?: boolean;
  initialFocus?: ElementNode | (() => ElementNode | undefined);
  children?: JSX.Element;
}

/**
 * Bottom sheet. This is the Flutter `showModalBottomSheet` shape built on the
 * same modal behaviour: dimmed barrier, safe-area padding, Back/Escape close
 * and focus restoration.
 */
export function Sheet(props: SheetProps): JSX.Element {
  const theme = useTheme();
  const scale = useUiScale();
  // A phone gets a bottom sheet; a desktop or TV window gets a card, because
  // there is no thumb reaching the bottom of a large screen.
  const card = () => supports('mouse') || supports('remote');
  const preferredHeight = () =>
    props.height ?? Math.min(640, viewport().height * 0.6);
  const bar = () => viewport().insets.safeArea.bottom;
  const keyboard = () =>
    props.avoidKeyboard === false ? 0 : viewport().insets.ime.bottom;
  // Apple's sheet title is a headline, not the display size a TV screen
  // uses. It scales with the app's type but stays in the sheet's range.
  const titleSize = () => Math.max(17, Math.min(24, theme.typography.body + 1));
  const titleY = () => 24;
  const grabberY = () => 8;
  const contentY = () => titleY() + Math.round(titleSize() * 1.4) + 12;
  const contentBottom = () => 16;
  const [dragY, setDragY] = createSignal(0);
  const [dragging, setDragging] = createSignal(false);
  let panel: ElementNode | undefined;
  const sheetWidth = () =>
    card()
      ? Math.min(
          Math.round(560 * scale),
          Math.max(
            0,
            viewport().width -
              viewport().insets.safeArea.left -
              viewport().insets.safeArea.right -
              32,
          ),
        )
      : viewport().width;
  const sheetX = () =>
    card()
      ? Math.round(
          viewport().insets.safeArea.left +
            (viewport().width -
              viewport().insets.safeArea.left -
              viewport().insets.safeArea.right -
              sheetWidth()) /
              2,
        )
      : 0;
  const sheetHeight = () => (card() ? height() : height() + bar());
  const baseY = () =>
    card()
      ? viewport().insets.safeArea.top +
        Math.max(
          16,
          (viewport().height -
            viewport().insets.safeArea.top -
            viewport().insets.safeArea.bottom -
            height()) /
            2,
        )
      : viewport().height - height() - bar() - keyboard();
  const drag = (
    phase: 'start' | 'move' | 'end' | 'cancel',
    point: { x: number; y: number },
    origin: { x: number; y: number },
  ) => {
    if (card()) return;
    if (phase === 'start') {
      setDragging(true);
      return;
    }
    if (phase === 'move') {
      setDragY(Math.max(0, point.y - origin.y));
      return;
    }
    setDragging(false);
    if (phase === 'end' && dragY() > height() * 0.3) {
      props.onRequestClose?.();
      return;
    }
    setDragY(0);
  };
  // Leave the status bar and the keyboard out of the sheet's own height: a
  // tall sheet plus a tall keyboard used to start above the safe area.
  const height = () =>
    Math.max(
      0,
      Math.min(
        preferredHeight(),
        viewport().height -
          viewport().insets.safeArea.top -
          bar() -
          keyboard() -
          24,
      ),
    );
  return (
    <Modal
      visible={props.visible}
      onRequestClose={props.onRequestClose}
      label={props.label}
      transparent
      // A sheet dims its parent and its own surface takes the tap: a tap
      // inside must not fall through to the barrier and dismiss it.
      barrierColor={0x00000080}
      dismissOnBackdrop={false}
      useSafeArea={false}
      // The panel slides itself in and out; Modal only dims around it.
      centeredMotion={false}
      panelExit={() =>
        panel === undefined
          ? Promise.resolve()
          : // From wherever the panel sits — dragged halfway down, or at
            // rest — it continues off the edge rather than vanishing.
            overlayExit(
              panel,
              { alpha: 0, y: viewport().height },
              SHEET_EXIT_MOTION,
            )
      }
      initialFocus={props.initialFocus}
    >
      {/* The surface reaches the bottom edge (behind the navigation bar);
          its content stops above it. */}
      <view
        id="sheet-panel"
        ref={(node) => {
          panel = node as ElementNode;
        }}
        onCreate={(el) =>
          overlayEnter(el, { alpha: 0, y: viewport().height }, SHEET_MOTION)
        }
        // Before `y`: within one flush, this effect runs first, so a drag's
        // first move already writes `y` with the settle transition held off
        // and the panel tracks the finger exactly, not through a 180 ms
        // settle that starts from rest.
        transition={
          dragging()
            ? undefined
            : {
                y: {
                  duration: Config.animationsEnabled ? 180 : 0,
                  easing: 'ease-out',
                },
              }
        }
        x={sheetX()}
        y={baseY() + dragY()}
        width={sheetWidth()}
        height={sheetHeight()}
        color={theme.colors.surfaceRaised}
        borderRadius={
          card()
            ? theme.radius.medium
            : [theme.radius.medium, theme.radius.medium, 0, 0]
        }
        // Children: grabber (0), title (1), content (2). Focus goes to the
        // app's content, not to the sheet's own heading.
        forwardFocus={2}
        onMouseClick={() => true}
      >
        {/* The grabber is the one control every sheet has: it says the
            surface can be dragged down. Decorative, so it never takes focus. */}
        {/* Always a child, so the content keeps its index; invisible on a
            desktop/TV card, which has no drag gesture. */}
        <view
          skipFocus
          x={(sheetWidth() - 36) / 2}
          y={grabberY()}
          width={36}
          height={5}
          borderRadius={2.5}
          alpha={card() ? 0 : 1}
          color={theme.colors.border}
        />
        <text
          skipFocus
          x={24}
          y={titleY()}
          width={sheetWidth() - 48}
          contain="width"
          maxLines={2}
          fontSize={titleSize()}
          fontWeight={700}
          color={theme.colors.text}
        >
          {props.title ?? props.label}
        </text>
        <view
          x={24}
          y={contentY()}
          width={sheetWidth() - 48}
          height={Math.max(0, height() - contentY() - contentBottom())}
          forwardFocus={focusContent}
        >
          {props.children}
        </view>
        {/* The grabber/title strip is the drag handle: pulling it down and
            past a third of the sheet dismisses, as an iOS sheet does. It
            paints nothing, but it must not be `skipFocus`: the pointer's hit
            test passes over skip-focus nodes too, and an invisible handle
            could never be grabbed. A tap on it does nothing, like a tap on
            the panel. */}
        <Show when={!card()}>
          <view
            id="sheet-drag"
            x={0}
            y={0}
            width={sheetWidth()}
            height={contentY()}
            onPointerDrag={drag}
            onMouseClick={() => true}
            cursorStyle="grab"
          />
        </Show>
      </view>
    </Modal>
  );
}
