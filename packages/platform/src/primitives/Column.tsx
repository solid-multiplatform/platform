import { onCleanup, type Component } from 'solid-js';
import {
  ElementNode,
  combineStyles,
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
import { scrollColumn } from './utils/withScrolling.js';
import { chainFunctions, chainRefs } from './utils/chainFunctions.js';
import { registerFocusKey, unregisterFocusKey } from './screenHistory.js';
import type { ColumnProps } from './types.js';

const ColumnStyles: NodeStyles = {
  display: 'flex',
  flexDirection: 'column',
  gap: 30,
};

function scrollToIndex(
  this: ElementNode,
  index: number,
  options?: { noFocus?: boolean },
): void {
  const lastSelected = this.selected;
  this.selected = index;
  scrollColumn(
    index,
    this,
    undefined,
    lastSelected === index ? undefined : lastSelected,
  );
  if (!options?.noFocus) {
    this.children[index]?.setFocus();
  }
}

const onUp = handleNavigation('up');
const onDown = handleNavigation('down');
const onPage = pageNavigation('y');
const onWheel = wheelNavigation('y');

export const Column: Component<ColumnProps> = (props) => {
  let columnNode: ElementNode | undefined;
  onCleanup(() => {
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
        }, props.ref)
      }
      onUp={/* @once */ chainFunctions(props.onUp, onUp)}
      onDown={/* @once */ chainFunctions(props.onDown, onDown)}
      onKeyPress={/* @once */ chainFunctions(props.onKeyPress, onPage)}
      onPointerScroll={
        /* @once */ chainFunctions(props.onPointerScroll, onWheel)
      }
      selected={props.selected || 0}
      scrollToIndex={scrollToIndex}
      forwardFocus={navigableForwardFocus}
      onLayout={
        /* @once */
        props.selected
          ? chainFunctions(props.onLayout, scrollColumn)
          : props.onLayout
      }
      onSelectedChanged={
        /* @once */ chainFunctions(
          props.onSelectedChanged,
          props.scroll !== 'none' ? scrollColumn : undefined,
        )
      }
      style={/* @once */ combineStyles(props.style, ColumnStyles)}
    />
  );
};
