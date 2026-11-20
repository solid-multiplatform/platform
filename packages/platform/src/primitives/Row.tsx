import { onCleanup, type Component } from 'solid-js';
import {
  combineStyles,
  type NodeStyles,
  type ElementNode,
} from '@solid-multiplatform/platform';
import { chainFunctions, chainRefs } from './utils/chainFunctions.js';
import { registerFocusKey, unregisterFocusKey } from './screenHistory.js';
import {
  handleNavigation,
  navigableForwardFocus,
  defaultTransitionBack,
  defaultTransitionForward,
} from './utils/handleNavigation.js';
import type { RowProps } from './types.js';
import { scrollRow, scrollRowIntoView } from './utils/withScrolling.js';

const RowStyles: NodeStyles = {
  display: 'flex',
  gap: 30,
};

function scrollToIndex(
  this: ElementNode,
  index: number,
  options?: { noFocus?: boolean },
) {
  this.selected = index;
  // A jump, not a step: tvOS scrolls the focused item fully into view.
  scrollRowIntoView(this, this.children[index]);
  if (!options?.noFocus) {
    this.children[index]?.setFocus();
  }
}

const onLeft = handleNavigation('left');
const onRight = handleNavigation('right');

export const Row: Component<RowProps> = (props) => {
  let rowNode: ElementNode | undefined;
  onCleanup(() => {
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
        }, props.ref)
      }
      selected={props.selected || 0}
      onLeft={/* @once */ chainFunctions(props.onLeft, onLeft)}
      onRight={/* @once */ chainFunctions(props.onRight, onRight)}
      forwardFocus={navigableForwardFocus}
      scrollToIndex={scrollToIndex}
      onLayout={
        /* @once */
        props.selected
          ? chainFunctions(props.onLayout, scrollRow)
          : props.onLayout
      }
      onSelectedChanged={
        /* @once */ chainFunctions(
          props.onSelectedChanged,
          props.scroll !== 'none' ? scrollRow : undefined,
        )
      }
      style={/* @once */ combineStyles(props.style, RowStyles)}
    />
  );
};
