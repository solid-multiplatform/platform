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
import type { RowProps, OnSelectedChanged } from './types.js';
import { scrollRow, scrollRowIntoView } from './utils/withScrolling.js';
import {
  bindTouchScroll,
  supportsTouchScroll,
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
  // Opt-in and host-gated: a TV remote has no pointer, so its focus
  // scrolling is untouched even if the prop is present.
  const touch = props.scroll === 'touch' && supportsTouchScroll();

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
          if (touch)
            touchBinding = bindTouchScroll(node, {
              axis: 'x',
              snap: snapSlot,
            });
        }, props.ref)
      }
      selected={props.selected || 0}
      onLeft={/* @once */ chainFunctions(props.onLeft, onLeft)}
      onRight={/* @once */ chainFunctions(props.onRight, onRight)}
      onPointerDrag={
        /* @once */ touch
          ? chainFunctions(props.onPointerDrag, drag)
          : props.onPointerDrag
      }
      onKeyPress={/* @once */ chainFunctions(props.onKeyPress, onPage)}
      onPointerScroll={
        /* @once */ chainFunctions(props.onPointerScroll, onWheel)
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
