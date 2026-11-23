import { Show, createEffect, onCleanup, type JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import { activeElement } from '../core/activeElement.js';
import type { ForwardFocusHandler } from '../core/focusKeyTypes.js';
import {
  focusNearestLiveAncestor,
  pushFocusTrap,
  syncSelectedAncestors,
} from '../core/focusManager.js';
import { isElementNode } from '../core/utils.js';
import { supports } from '../sdk/capabilities.js';
import { viewport } from '../sdk/viewport.js';
import { OVERLAY_FADE_IN, overlayEnter, overlayExit } from './FadeInOut.jsx';
import { Portal } from './portal.jsx';

// The barrier dims in and out through its own colour, never its node alpha:
// the panel is inside the barrier, and a fading barrier would fade the panel
// with it. 200 ms of `ease-out` is UIKit's quick dim around a presentation.
const BARRIER_MOTION = { duration: 200, easing: 'ease-out' } as const;
// The centred entrance Modal gives the whole surface when the panel does not
// run its own (see OVERLAY_FADE_IN for why the fade starts above 0).
const CENTERED_ENTER = { alpha: OVERLAY_FADE_IN, scale: 0.96 };
const CENTERED_EXIT = { alpha: 0, scale: 0.96 };
const CENTERED_MOTION = { duration: 250, easing: 'ease-in-out' } as const;

// Focus on the dialog goes to its content: the first child of the safe-area
// view that takes focus. With none the dialog keeps it, so that Back closes.
const focusPanel: ForwardFocusHandler = function () {
  const content = this.children[0];
  if (!isElementNode(content)) return false;
  const children = content.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (isElementNode(child) && !child.skipFocus) {
      child.setFocus();
      return true;
    }
  }
  return false;
};

export interface ModalProps {
  /** Controlled visibility. Pass an accessor to follow application state. */
  visible: boolean | (() => boolean);
  /** Called for the hardware Back key, Escape, or a barrier tap. */
  onRequestClose?(): void;
  /** Draw the application behind the modal instead of an opaque backdrop. */
  transparent?: boolean;
  /** Backdrop colour when not transparent. 0xRRGGBBAA. */
  barrierColor?: number;
  /** Inset the panel by the host safe area. Defaults to true. */
  useSafeArea?: boolean;
  /** Accessible name for the dialog. */
  label: string;
  /** `alertdialog` for a message that interrupts. Defaults to `dialog`. */
  role?: 'dialog' | 'alertdialog';
  /**
   * Element to focus when the modal opens. Defaults to the modal's first
   * child that takes focus (a `Row` or `Column` passes it on to its own),
   * and to the dialog itself when there is none.
   */
  initialFocus?: ElementNode | (() => ElementNode | undefined);
  /** Tapping the backdrop requests close. Defaults to true. */
  dismissOnBackdrop?: boolean;
  /**
   * What a backdrop tap does instead of closing. A compact picker confirms
   * its current value on an outside tap, where a modal sheet does not.
   */
  onBackdrop?(): void;
  /**
   * Whether Modal runs the standard centred entrance and exit on the whole
   * surface — a fade with a slight scale-up about the centre — or leaves the
   * motion to the panel it contains: a sheet, drawer or popover slides or
   * scales its own panel. The barrier dims and undims either way. Defaults to
   * true.
   */
  centeredMotion?: boolean;
  /**
   * The panel's own exit, run when the overlay begins to close: resolve once
   * the panel has finished leaving. The overlay — its barrier included —
   * stays on screen until then, so nothing pops out in a single frame.
   * Reduced motion or `Config.animationsEnabled` off makes the close
   * immediate. A surface whose panel stays put omits it.
   */
  panelExit?(): Promise<void>;
  ref?: (node: ElementNode) => void;
  children?: JSX.Element;
}

/**
 * A modal surface with the established behaviour shared by React Native's
 * `Modal`, Flutter's `showDialog` and the HTML `<dialog>` element:
 *
 * - renders above the scene through a portal;
 * - restores the previously focused element on close;
 * - calls `onRequestClose` for Back/Escape and (optionally) a barrier tap;
 * - respects the host safe area unless `useSafeArea` is false.
 *
 * The scene's focus manager keeps focus inside the panel because the opening
 * focus is the panel or an explicit `initialFocus` child.
 */
export function Modal(props: ModalProps): JSX.Element {
  const visible = () =>
    typeof props.visible === 'function' ? props.visible() : props.visible;
  let dialog: ElementNode | undefined;
  let surface: ElementNode | undefined;
  let previous: ElementNode | undefined;
  let releaseTrap: (() => void) | undefined;
  let open = false;
  // The trap is pushed from a microtask, so a cleanup that wins the race
  // (the open and an unmount in one reactive flush) releases nothing — the
  // microtask must not then push a trap for a dialog that is already gone,
  // or the dead trap wedges every press and focus move app-wide.
  let unmounted = false;

  createEffect(() => {
    if (visible()) {
      if (open) return;
      open = true;
      queueMicrotask(() => {
        if (unmounted) return;
        // The invoking control is read here, not where the effect ran: an
        // opener that takes focus as it opens (a Select's trigger taps into
        // a menu while a text field edits) applies that focus in the
        // post-mutation phase, which runs before this microtask. Reading
        // earlier would restore the dialog to whatever had focus before
        // the tap, and closing it would reopen that field's editor.
        previous = activeElement();
        if (dialog && !releaseTrap) releaseTrap = pushFocusTrap(dialog);
        const focus = props.initialFocus;
        // An `initialFocus` that names nothing (a ref not set) leaves focus
        // to the dialog, which hands it to its content: never outside.
        const target =
          (typeof focus === 'function' ? focus() : focus) ?? dialog;
        target?.setFocus();
      });
    } else if (open) {
      open = false;
      releaseTrap?.();
      releaseTrap = undefined;
      // The invoking control may have been removed while the dialog was open.
      // Restore to it, or to the nearest surviving item of its container,
      // rather than leaving focus on a node that no longer exists.
      if (previous !== undefined) {
        if (previous.destroyed) focusNearestLiveAncestor(previous);
        else {
          previous.setFocus();
          syncSelectedAncestors(previous);
        }
      }
      previous = undefined;
    }
  });

  onCleanup(() => {
    unmounted = true;
    releaseTrap?.();
    releaseTrap = undefined;
    if (open && previous !== undefined) {
      if (previous.destroyed) focusNearestLiveAncestor(previous);
      else {
        previous.setFocus();
        syncSelectedAncestors(previous);
      }
    }
  });

  const close = () => props.onRequestClose?.();
  const key = (event: KeyboardEvent) => {
    // Escape is the keyboard's dismiss; GoBack is a remote's Back. A real
    // Backspace is a text-editing key and must not close a dialog, but the
    // dispatcher's synthetic Back arrives as a marked Backspace so hardware
    // Back still dismisses.
    if (
      event.key === 'Escape' ||
      event.key === 'GoBack' ||
      (event.key === 'Backspace' &&
        (supports('remote') ||
          (event as unknown as { synthetic?: boolean }).synthetic === true))
    ) {
      close();
      return true;
    }
    return false;
  };

  return (
    <Show when={visible()}>
      <Portal>
        <view
          ref={(node) => {
            dialog = node as ElementNode;
            props.ref?.(node as ElementNode);
          }}
          role={props.role ?? 'dialog'}
          forwardFocus={focusPanel}
          ariaLabel={props.label}
          width={viewport().width}
          height={viewport().height}
          color={
            props.transparent
              ? (props.barrierColor ?? 0x00000000)
              : (props.barrierColor ?? 0x000000cc)
          }
          onKeyPress={key}
          onCreate={(el) => {
            // The dim fades in around the panel; the panel's own motion (or
            // the surface's, below) runs beside it.
            overlayEnter(el, { color: 0 }, BARRIER_MOTION);
          }}
          onDestroy={(el) => {
            // The overlay unmounts here, and the exits below are what keep
            // it on screen: destroy() waits for this promise before it frees
            // the node, so the panel leaves the way it came in.
            const exits = [overlayExit(el, { color: 0 }, BARRIER_MOTION)];
            if (surface !== undefined && props.centeredMotion !== false)
              exits.push(overlayExit(surface, CENTERED_EXIT, CENTERED_MOTION));
            const panelExit = props.panelExit;
            if (panelExit !== undefined) exits.push(panelExit());
            return Promise.all(exits).then(() => undefined);
          }}
          onMouseClick={
            props.dismissOnBackdrop === false
              ? undefined
              : () => {
                  // A barrier tap only fires when the tap is not inside the
                  // panel; the panel's own handlers stop before this one.
                  if (props.onBackdrop !== undefined) props.onBackdrop();
                  else close();
                }
          }
        >
          <view
            ref={(node) => {
              surface = node as ElementNode;
            }}
            x={
              props.useSafeArea === false ? 0 : viewport().insets.safeArea.left
            }
            y={props.useSafeArea === false ? 0 : viewport().insets.safeArea.top}
            width={
              viewport().width -
              (props.useSafeArea === false
                ? 0
                : viewport().insets.safeArea.left +
                  viewport().insets.safeArea.right)
            }
            height={
              viewport().height -
              (props.useSafeArea === false
                ? 0
                : viewport().insets.safeArea.top +
                  viewport().insets.safeArea.bottom)
            }
            onCreate={
              props.centeredMotion === false
                ? undefined
                : (el) => {
                    // The standard centred entrance, as a presenting dialog:
                    // it lands exactly on the static layout, where it rests.
                    overlayEnter(el, CENTERED_ENTER, CENTERED_MOTION);
                  }
            }
          >
            {props.children}
          </view>
        </view>
      </Portal>
    </Show>
  );
}
