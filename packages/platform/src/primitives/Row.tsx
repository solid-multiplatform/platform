import { onCleanup, type Component } from 'solid-js';
import {
  combineStyles,
  isElementNode,
  type NodeStyles,
  type ElementNode,
} from '@solid-multiplatform/platform';
import { chainFunctions, chainRefs } from './utils/chainFunctions.js';
import { registerFocusKey, unregisterFocusKey } from './screenHistory.js';
import {
  handleNavigation,
  navigableForwardFocus,
  pageNavigation,
  wheelNavigation,
  defaultTransitionBack,
  defaultTransitionForward,
} from './utils/handleNavigation.js';
import type { RevealElement, RowProps, OnSelectedChanged } from './types.js';
import { scrollRow, scrollRowIntoView } from './utils/withScrolling.js';
import {
  bindTouchScroll,
  defaultTouchScroll,
  supportsTouchScroll,
  TOUCH_SCROLL_COMPILED,
  type TouchScrollBinding,
} from './utils/touchScroll.js';

const RowStyles: NodeStyles = {
  display: 'flex',
  gap: 30,
};

const onLeft = handleNavigation('left');
const onRight = handleNavigation('right');
const onPage = pageNavigation('x');
const onWheel = wheelNavigation('x');

export const Row: Component<RowProps> = (props) => {
  let rowNode: ElementNode | undefined;
  let touchBinding: TouchScrollBinding | undefined;
  // Apple's default on a pointer host: a row that overflows is draggable and
  // wheel-scrollable without the app opting in. A TV remote has no pointer,
  // so its focus scrolling is untouched; an explicit focus-scroll mode
  // (`auto`, `edge`, `center`, `bounded`) or `none` still wins.
  const touch =
    // The compiled const folds to `false` on TV bundles, so the engine and
    // the router below drop out as dead code; the runtime check inside the
    // capability functions stays the fallback for builds without the define.
    TOUCH_SCROLL_COMPILED &&
    supportsTouchScroll() &&
    (props.scroll === 'touch' ||
      (props.scroll === undefined && defaultTouchScroll()));

  // A rail snaps to one item plus the gap. The second child's start is the
  // slot: it already includes the gap and follows non-uniform first items.
  const snapSlot = () => {
    if (rowNode === undefined) return 0;
    const first = rowNode.children[0];
    const second = rowNode.children[1];
    if (first !== undefined && second !== undefined) {
      const slot = (second.x || 0) - (first.x || 0);
      if (slot > 0) return slot;
    }
    return first === undefined ? 0 : (first.width || 0) + (rowNode.gap || 0);
  };

  const drag = (
    phase: 'start' | 'move' | 'end' | 'cancel',
    point: { x: number; y: number },
    origin: { x: number; y: number },
  ) => touchBinding?.drag(phase, point, origin);

  const layoutTouch = () => touchBinding?.layout();
  const dragWheel = (event: { deltaX: number; deltaY: number }): boolean => {
    touchBinding?.wheel(event.deltaX);
    return true;
  };
  const revealInitial = () => {
    if (rowNode === undefined) return;
    const child = rowNode.children[rowNode.selected ?? 0];
    touchBinding?.reveal(isElementNode(child) ? child : undefined, 0);
  };
  const revealSelected: OnSelectedChanged = function (_index, _elm, active) {
    touchBinding?.reveal(active, 180);
  };

  function scrollToIndex(
    this: ElementNode,
    index: number,
    options?: { noFocus?: boolean },
  ) {
    this.selected = index;
    if (touchBinding !== undefined) {
      const child = this.children[index];
      touchBinding.reveal(isElementNode(child) ? child : undefined, 0);
    } else {
      // A jump, not a step: tvOS scrolls the focused item fully into view.
      scrollRowIntoView(this, this.children[index]);
    }
    if (!options?.noFocus) {
      this.children[index]?.setFocus();
    }
  }

  onCleanup(() => {
    touchBinding?.dispose();
    if (rowNode !== undefined) unregisterFocusKey(rowNode, props.focusKey);
  });
  return (
    <view
      role="list"
      transitionLeft={defaultTransitionBack}
      transitionRight={defaultTransitionForward}
      {...props}
      ref={
        /* @once */ chainRefs((node) => {
          rowNode = node;
          registerFocusKey(node, props.focusKey);
          if (touch) {
            touchBinding = bindTouchScroll(node, {
              axis: 'x',
              snap: snapSlot,
            });
            const scrollable = node as unknown as {
              revealElement?: RevealElement;
              scrollAxis?: 'x' | 'y';
            };
            scrollable.revealElement = (target, options) =>
              touchBinding?.revealElement(target, options);
            scrollable.scrollAxis = 'x';
          }
        }, props.ref)
      }
      selected={props.selected || 0}
      // An explicit width is a decision: a rail sized to the page must not
      // grow past it when its cards are wider. A content-sized row (no
      // width) still follows its children.
      flexBoundary={
        props.flexBoundary ?? (props.width !== undefined ? 'fixed' : undefined)
      }
      onLeft={/* @once */ chainFunctions(props.onLeft, onLeft)}
      onRight={/* @once */ chainFunctions(props.onRight, onRight)}
      onPointerDrag={
        /* @once */ touch
          ? chainFunctions(props.onPointerDrag, drag)
          : props.onPointerDrag
      }
      onKeyPress={/* @once */ chainFunctions(props.onKeyPress, onPage)}
      onPointerScroll={
        /* @once */
        touch
          ? chainFunctions(props.onPointerScroll, dragWheel)
          : chainFunctions(props.onPointerScroll, onWheel)
      }
      forwardFocus={navigableForwardFocus}
      scrollToIndex={scrollToIndex}
      onLayout={
        /* @once */
        touch
          ? chainFunctions(
              props.onLayout,
              layoutTouch,
              props.selected ? revealInitial : undefined,
            )
          : props.selected
            ? chainFunctions(props.onLayout, scrollRow)
            : props.onLayout
      }
      onSelectedChanged={
        /* @once */ chainFunctions(
          props.onSelectedChanged,
          touch
            ? revealSelected
            : props.scroll !== 'none'
              ? scrollRow
              : undefined,
        )
      }
      style={/* @once */ combineStyles(props.style, RowStyles)}
    />
  );
};
