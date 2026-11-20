import { onCleanup, type Component } from 'solid-js';
import {
  ElementNode,
  combineStyles,
  isElementNode,
  type NodeStyles,
} from '@solid-multiplatform/platform';
import {
  navigableForwardFocus,
  handleNavigation,
  pageNavigation,
  wheelNavigation,
  defaultTransitionDown,
  defaultTransitionUp,
} from './utils/handleNavigation.js';
import { scrollColumn, scrollColumnIntoView } from './utils/withScrolling.js';
import { chainFunctions, chainRefs } from './utils/chainFunctions.js';
import { registerFocusKey, unregisterFocusKey } from './screenHistory.js';
import type { ColumnProps, OnSelectedChanged } from './types.js';
import {
  bindTouchScroll,
  supportsTouchScroll,
  type TouchScrollBinding,
} from './utils/touchScroll.js';

const ColumnStyles: NodeStyles = {
  display: 'flex',
  flexDirection: 'column',
  gap: 30,
};

const onUp = handleNavigation('up');
const onDown = handleNavigation('down');
const onPage = pageNavigation('y');
const onWheel = wheelNavigation('y');

export const Column: Component<ColumnProps> = (props) => {
  let columnNode: ElementNode | undefined;
  let touchBinding: TouchScrollBinding | undefined;
  // Opt-in and host-gated: a TV remote has no pointer, so its focus
  // scrolling is untouched even if the prop is present.
  const touch = props.scroll === 'touch' && supportsTouchScroll();

  const drag = (
    phase: 'start' | 'move' | 'end' | 'cancel',
    point: { x: number; y: number },
    origin: { x: number; y: number },
  ) => touchBinding?.drag(phase, point, origin);

  const layoutTouch = () => touchBinding?.layout();
  const dragWheel = (event: { deltaX: number; deltaY: number }): boolean => {
    touchBinding?.wheel(event.deltaY);
    return true;
  };
  const revealInitial = () => {
    if (columnNode === undefined) return;
    const child = columnNode.children[columnNode.selected ?? 0];
    touchBinding?.reveal(isElementNode(child) ? child : undefined, 0);
  };
  const revealSelected: OnSelectedChanged = function (_index, _elm, active) {
    touchBinding?.reveal(active, 180);
  };

  function scrollToIndex(
    this: ElementNode,
    index: number,
    options?: { noFocus?: boolean },
  ): void {
    this.selected = index;
    if (touchBinding !== undefined) {
      const child = this.children[index];
      touchBinding.reveal(isElementNode(child) ? child : undefined, 0);
    } else {
      // A jump, not a step: tvOS scrolls the focused item fully into view.
      scrollColumnIntoView(this, this.children[index]);
    }
    if (!options?.noFocus) {
      this.children[index]?.setFocus();
    }
  }

  onCleanup(() => {
    touchBinding?.dispose();
    if (columnNode !== undefined)
      unregisterFocusKey(columnNode, props.focusKey);
  });
  return (
    <view
      role="list"
      transitionUp={defaultTransitionUp}
      transitionDown={defaultTransitionDown}
      {...props}
      ref={
        /* @once */ chainRefs((node) => {
          columnNode = node;
          registerFocusKey(node, props.focusKey);
          if (touch)
            touchBinding = bindTouchScroll(node, {
              axis: 'y',
            });
        }, props.ref)
      }
      onUp={/* @once */ chainFunctions(props.onUp, onUp)}
      onDown={/* @once */ chainFunctions(props.onDown, onDown)}
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
      selected={props.selected || 0}
      scrollToIndex={scrollToIndex}
      forwardFocus={navigableForwardFocus}
      onLayout={
        /* @once */
        touch
          ? chainFunctions(
              props.onLayout,
              layoutTouch,
              props.selected ? revealInitial : undefined,
            )
          : props.selected
            ? chainFunctions(props.onLayout, scrollColumn)
            : props.onLayout
      }
      onSelectedChanged={
        /* @once */ chainFunctions(
          props.onSelectedChanged,
          touch
            ? revealSelected
            : props.scroll !== 'none'
              ? scrollColumn
              : undefined,
        )
      }
      style={/* @once */ combineStyles(props.style, ColumnStyles)}
    />
  );
};
