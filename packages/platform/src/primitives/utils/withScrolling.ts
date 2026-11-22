import type {
  ElementNode,
  ElementText,
  INode,
  Styles,
} from '../../core/index.js';
import { supports } from '../../sdk/capabilities.js';
import { contentExtent } from './contentExtent.js';

export type Scroller = (
  selected: number | ElementNode,
  component?: ElementNode,
  selectedElement?: ElementNode | ElementText,
  lastSelected?: number,
) => void;

// Adds properties expected by withScrolling
export interface ScrollableElement extends ElementNode {
  scrollIndex?: number;
  scroll?: 'always' | 'none' | 'edge' | 'auto' | 'center' | 'bounded' | 'touch';
  selected: number;
  offset?: number;
  endOffset?: number;
  upCount?: number;
  onScrolled?: (
    elm: ScrollableElement,
    offset: number,
    isInitial: boolean,
  ) => void;
  _targetPosition?: number;
  _screenOffset?: number;
  _initialPosition?: number;
  scrollStopLast?: boolean;
}

/**
 * Whether an item is not fully inside the clipping band. Geometry, not the
 * backend's `renderState`: the DOM/Canvas test backends and some hosts do not
 * cull, and a node can be `InViewport` yet partly under a bar. tvOS reveals
 * an item when it is not fully visible, which is exactly this test.
 */
const isNotShown = (
  node: ElementNode | ElementText,
  component: ScrollableElement,
  isRow: boolean,
): boolean => {
  const band = visibleBand(component, isRow);
  const dimension = isRow ? 'width' : 'height';
  const abs = (isRow ? node.absX : node.absY) as number;
  const start = abs - band.start;
  const size = (node[dimension] as number) || 0;
  return start < 0 || start + size > band.size + 0.5;
};

// The geometry one scroll step needs, read once. `start` is the container
// position that shows the first item (the user's `offset` when given) and
// `maxOffset` the furthest it may travel; both come from the same arithmetic
// `withScrolling` clamps with, so ensuring visibility below cannot overscroll.
interface ScrollBounds {
  axis: 'x' | 'y';
  dimension: 'width' | 'height';
  screenSize: number;
  /** The clipping ancestor's absolute start and size on the scroll axis. */
  bandStart: number;
  bandSize: number;
  position: number;
  initialPosition: number;
  start: number;
  maxOffset: number;
}

function visibleBand(
  component: ScrollableElement,
  isRow: boolean,
): { start: number; size: number } {
  const dimension = isRow ? 'width' : 'height';
  let parent = component.parent;
  while (parent !== undefined && !parent.clipping) parent = parent.parent;
  const lng = component.lng as unknown as INode;
  const root = lng.stage.root;
  if (parent !== undefined) {
    return {
      start: ((isRow ? parent.absX : parent.absY) as number) || 0,
      size: (parent[dimension] as number) || 0,
    };
  }
  return { start: 0, size: (isRow ? root.w : root.h) || 0 };
}

function scrollBounds(
  component: ScrollableElement,
  isRow: boolean,
): ScrollBounds {
  const axis = isRow ? 'x' : 'y';
  const dimension = isRow ? 'width' : 'height';
  const lng = component.lng as unknown as INode;
  const root = lng.stage.root;
  const screenSize = isRow ? root.w : root.h;
  const position = component[axis] ?? 0;
  const initialPosition = component._initialPosition ?? position;
  const gap = component.gap || 0;

  let screenOffset = component._screenOffset;
  if (screenOffset === undefined) {
    screenOffset = component.offset ?? (isRow ? lng.absX : lng.absY) - position;
    component._screenOffset = screenOffset;
  }
  let endOffset = component.endOffset;
  if (endOffset === undefined) {
    const p = component.parent;
    if (p && p.clipping) {
      endOffset = screenSize - ((isRow ? p.absX : p.absY) || 0) - p[dimension];
      component.endOffset = endOffset;
    }
  }

  const start = component.offset ?? initialPosition;
  const maxOffset = Math.min(
    screenSize -
      contentExtent(component, axis) -
      screenOffset -
      (endOffset ?? 2 * gap),
    start,
  );
  const band = visibleBand(component, isRow);
  return {
    axis,
    dimension,
    screenSize,
    bandStart: band.start,
    bandSize: band.size,
    position,
    initialPosition,
    start,
    maxOffset,
  };
}

/**
 * Moves `candidate` the least distance that shows `selectedEl` completely,
 * clamped to the container's own travel. tvOS scrolls content so a focused
 * item is never half visible; this is the guarantee the scroll modes cannot
 * make on their own when items differ in size or focus jumps.
 */
function keepVisible(
  selectedEl: ElementNode | ElementText,
  bounds: ScrollBounds,
  candidate: number,
): number {
  const size = (selectedEl[bounds.dimension] as number | undefined) ?? 0;
  const scale =
    (selectedEl.scale as number | undefined) ??
    (selectedEl.$focus as Styles | undefined)?.scale ??
    1;
  const scaled = size * scale;
  // A focused item scales about its centre.
  const centreInset = (scaled - size) / 2;
  const lng = selectedEl.lng as unknown as { absX: number; absY: number };
  const abs = bounds.axis === 'x' ? lng.absX : lng.absY;
  // The candidate position translates the selection by (candidate - position).
  // Measure against the clipping ancestor, not the whole stage: a focused
  // item below a top bar or beside a sidebar is still occluded.
  const start =
    abs - bounds.bandStart + (candidate - bounds.position) - centreInset;
  let next = candidate;
  if (start < 0) next -= start;
  else if (start + scaled > bounds.bandSize)
    next -= start + scaled - bounds.bandSize;
  if (next < bounds.maxOffset) next = bounds.maxOffset;
  else if (next > bounds.start) next = bounds.start;
  return next;
}

function applyScrollPosition(
  component: ScrollableElement,
  bounds: ScrollBounds,
  next: number,
): void {
  const position = component[bounds.axis];
  if (position === next) return;
  const onScrolled = component.onScrolled;
  if (onScrolled) {
    onScrolled.call(
      component,
      component,
      next,
      next === bounds.initialPosition,
    );
  }
  component[bounds.axis] = next;
  component._targetPosition = next;
}

/**
 * Scrolls `component` so the selected child is fully inside the viewport.
 * This is the tvOS rule: content scrolls to keep the focused item visible.
 * `scroll: "none"` still opts out. Used by `scrollToIndex` and when focus
 * re-enters a container on an already selected item.
 */
export function ensureSelectionVisible(
  component: ScrollableElement,
  isRow: boolean,
  selectedElement?: ElementNode | ElementText,
): void {
  const children = component.children;
  if (component.scroll === 'none' || children.length === 0) return;
  const selected = component.selected || 0;
  const selectedEl = selectedElement ?? children[selected];
  if (selectedEl === undefined) return;
  const bounds = scrollBounds(component, isRow);
  applyScrollPosition(
    component,
    bounds,
    keepVisible(selectedEl, bounds, bounds.position),
  );
}

export const scrollRowIntoView = /* @__PURE__ */ (
  component: ElementNode,
  selectedElement?: ElementNode | ElementText,
): void =>
  ensureSelectionVisible(component as ScrollableElement, true, selectedElement);
export const scrollColumnIntoView = /* @__PURE__ */ (
  component: ElementNode,
  selectedElement?: ElementNode | ElementText,
): void =>
  ensureSelectionVisible(
    component as ScrollableElement,
    false,
    selectedElement,
  );
/*
  Auto Scrolling starts scrolling right away until the last item is shown. Keeping a full view of the list.
  Edge starts scrolling when it reaches the edge of the viewport.
  Always scroll moves the list every time
*/

/**
 * Checks if the selected index is in the non-scrollable zone (last upCount items).
 */
export function checkIsInNonScrollableZone(
  componentRef: ScrollableElement,
): boolean {
  const totalItems = componentRef.children.length;
  const upCount = componentRef.upCount || 6;
  const selected = componentRef.selected || 0;
  const nonScrollableZoneStart = Math.max(0, totalItems - upCount);
  return selected >= nonScrollableZoneStart;
}

/** @deprecated Use {@link scrollRow} or {@link scrollColumn} */
export function withScrolling(isRow: boolean): Scroller {
  const dimension = isRow ? 'width' : 'height';
  const axis = isRow ? 'x' : 'y';

  return (selected, component, selectedElement, lastSelected) => {
    let componentRef = component as ScrollableElement;
    if (typeof selected !== 'number') {
      componentRef = selected as ScrollableElement;
      selected = componentRef.selected || 0;
    }
    if (!componentRef) return;
    // Each input is read once into a local: on renderer v2 every node prop
    // read goes through an accessor. A host without a pointer ignores
    // `touch`: focus scrolling behaves as the default `auto`.
    const scrollProp =
      componentRef.scroll === 'touch' ? 'auto' : componentRef.scroll;
    const children = componentRef.children;
    const childCount = children.length;
    if (scrollProp === 'none' || !childCount) return;
    // Focus can land on an already selected item: a later key after a
    // programmatic `selected`, or focus re-entering the container. The scroll
    // modes would step again, so only the visibility guarantee runs here.
    if (selected === lastSelected) {
      ensureSelectionVisible(
        componentRef,
        isRow,
        selectedElement || children[selected],
      );
      return;
    }

    const position = componentRef[axis];
    let initialPosition = componentRef._initialPosition;
    if (initialPosition === undefined) {
      initialPosition = position;
      componentRef._initialPosition = position;
    }

    const lng = componentRef.lng as unknown as INode;
    const root = lng.stage.root;
    const screenSize = isRow ? root.w : root.h;
    const band = visibleBand(componentRef, isRow);
    // Determine if movement is incremental or decremental
    const isIncrementing =
      lastSelected === undefined || lastSelected - 1 !== selected;

    let offset = componentRef.offset;
    let endOffset = componentRef.endOffset;
    let screenOffset = componentRef._screenOffset;
    if (screenOffset === undefined) {
      const p = componentRef.parent!;
      if (p.clipping) {
        endOffset =
          endOffset ??
          screenSize - ((isRow ? p.absX : p.absY) || 0) - p[dimension];
        componentRef.endOffset = endOffset;
      }

      screenOffset = offset ?? (isRow ? lng.absX : lng.absY) - position;
      componentRef._screenOffset = screenOffset;
    }

    const gap = componentRef.gap || 0;
    const scrollIndex = componentRef.scrollIndex;
    // when creating we set scroll to always so we setup the right location for selected and scrollIndex
    // tvOS reveals focus by the least distance, so an undefined scroll mode
    // is `edge` on a remote; a pointer host keeps the stepping `auto`.
    const scroll =
      scrollProp ||
      (lastSelected === undefined
        ? scrollIndex
          ? 'center'
          : 'always'
        : supports('remote')
          ? 'edge'
          : 'auto');

    // Allows manual position control
    const targetPosition = componentRef._targetPosition ?? position;
    const rootPosition = isIncrementing
      ? Math.min(targetPosition, position)
      : Math.max(targetPosition, position);
    offset = offset ?? rootPosition;
    componentRef.offset = offset;
    const selectedEl = selectedElement || children[selected];

    if (!selectedEl) {
      return;
    }
    const selectedPosition = selectedEl[axis] ?? 0;
    const selectedSize = selectedEl[dimension] ?? 0;
    // `$focus`, not `style.focus`: the focus state's styles live on the node
    // under the state key, and the `style` getter allocates when unset.
    const selectedScale =
      selectedEl.scale ?? (selectedEl.$focus as Styles | undefined)?.scale ?? 1;
    const selectedSizeScaled = selectedSize * selectedScale;
    const containerSize = contentExtent(componentRef, axis);
    const maxOffset = Math.min(
      screenSize - containerSize - screenOffset - (endOffset ?? 2 * gap),
      offset,
    );

    // Determine the next element based on whether incrementing or decrementing
    const nextIndex = isIncrementing ? selected + 1 : selected - 1;
    const nextElement = children[nextIndex] || null;
    const scrollStopLast = componentRef.scrollStopLast;

    // Default nextPosition to align with the selected position and offset
    let nextPosition = rootPosition;

    // Update nextPosition based on scroll type and specific conditions
    if (selectedEl.centerScroll) {
      nextPosition =
        band.start +
        band.size / 2 -
        screenOffset -
        selectedPosition -
        selectedSizeScaled / 2;
    } else if (scroll === 'always') {
      nextPosition = -selectedPosition + offset;
    } else if (scroll === 'bounded') {
      const upCount = componentRef.upCount || 6;
      const nonScrollableZoneStart = Math.max(0, childCount - upCount);
      const isInNonScrollableZone = selected >= nonScrollableZoneStart;
      const isFirstOfNonScrollableZone = selected === nonScrollableZoneStart;
      const isEnteringZone =
        isFirstOfNonScrollableZone &&
        lastSelected !== undefined &&
        lastSelected < nonScrollableZoneStart;

      if (!isInNonScrollableZone) {
        nextPosition = -selectedPosition + offset;
      } else if (isIncrementing) {
        if (isEnteringZone) {
          const firstOfZoneElement = children[nonScrollableZoneStart];
          nextPosition = firstOfZoneElement
            ? -(firstOfZoneElement[axis] ?? 0) + offset
            : rootPosition;
        } else {
          nextPosition = rootPosition;
        }
      } else if (isFirstOfNonScrollableZone) {
        nextPosition = -selectedPosition + offset;
      } else {
        nextPosition = rootPosition;
      }
    } else if (scroll === 'center') {
      const centerPosition =
        -selectedPosition +
        (screenSize - selectedSizeScaled) / 2 -
        screenOffset;
      // clamp position to avoid going beyond bounds
      nextPosition = Math.min(Math.max(centerPosition, maxOffset), offset);
    } else if (!nextElement) {
      // If at the last element, align to end
      if (scrollStopLast && isIncrementing) {
        nextPosition = rootPosition - selectedSize - gap;
      } else {
        nextPosition = isIncrementing ? maxOffset : offset;
      }
    } else if (scroll === 'auto') {
      if (scrollIndex && scrollIndex > 0) {
        // Prevent scrolling if the selected item is within the last scrollIndex items
        const nearEndIndex = childCount - scrollIndex;
        const currentSelected = componentRef.selected;

        if (isIncrementing && currentSelected >= scrollIndex) {
          nextPosition = rootPosition - selectedSize - gap;
        } else if (!isIncrementing && currentSelected < nearEndIndex) {
          nextPosition = rootPosition + selectedSize + gap;
        }
      } else if (isIncrementing) {
        nextPosition = rootPosition - selectedSize - gap;
      } else {
        nextPosition = rootPosition + selectedSize + gap;
      }
    } // Handle Edge scrolling
    else if (isNotShown(selectedEl, componentRef, isRow)) {
      nextPosition = isIncrementing
        ? rootPosition - selectedSize - gap
        : -selectedPosition + offset;
    }

    // Prevent container from moving beyond bounds
    const isScrollStopLastCase =
      scrollStopLast && !nextElement && isIncrementing;
    nextPosition =
      isIncrementing &&
      scroll !== 'always' &&
      scroll !== 'bounded' &&
      !isScrollStopLastCase
        ? Math.max(nextPosition, maxOffset)
        : Math.min(nextPosition, offset);

    // The modes above compute a step from item sizes, which assumes items are
    // uniform. tvOS guarantees the focused item is fully visible, so the
    // stepping modes finish by correcting the position when it is not. The
    // other modes (always, center, bounded) place the item deliberately.
    if ((scroll === 'auto' || scroll === 'edge') && !selectedEl.centerScroll) {
      nextPosition = keepVisible(
        selectedEl,
        {
          axis,
          dimension,
          screenSize,
          bandStart: band.start,
          bandSize: band.size,
          position,
          initialPosition,
          start: offset,
          maxOffset,
        },
        nextPosition,
      );
    }

    // Update position if it has changed
    if (position !== nextPosition) {
      const onScrolled = componentRef.onScrolled;
      if (onScrolled) {
        const isInitial = nextPosition === initialPosition;
        onScrolled.call(componentRef, componentRef, nextPosition, isInitial);
      }

      componentRef[axis] = nextPosition;
      // Store the new position to keep track during animations
      componentRef._targetPosition = nextPosition;
    }
  };
}

export const scrollRow = /* @__PURE__ */ withScrolling(true);
export const scrollColumn = /* @__PURE__ */ withScrolling(false);
