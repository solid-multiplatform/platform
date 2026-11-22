import {
  createSignal,
  createMemo,
  createEffect,
  createRenderEffect,
  JSX,
  untrack,
  Index,
  onCleanup,
} from 'solid-js';
import {
  type NodeProps,
  ElementNode,
  NewOmit,
  hasFocus,
  isElementNode,
} from '@solid-multiplatform/platform';
import { screenRect } from '../sdk/layout.js';
import { viewport } from '../sdk/viewport.js';
import { chainFunctions, chainRefs } from './utils/chainFunctions.js';
import {
  bindTouchScroll,
  defaultTouchScroll,
  supportsTouchScroll,
  type TouchScrollBinding,
} from './utils/touchScroll.js';
import {
  keyIndex,
  registerFocusKey,
  registerItemSource,
  setItemKey,
  unregisterFocusKey,
  unregisterItemSource,
} from './screenHistory.js';

export interface GridItemProps<T> {
  item: T;
  index: number;
  width: number;
  height: number;
  x: number;
  y: number;
}

export interface GridProps<T> extends NewOmit<NodeProps, 'children'> {
  /** Stable key for screen-history focus restore. */
  focusKey?: string;
  items: readonly T[];
  /** Stable key for one entry; screen-history restore resolves it against `items`. */
  itemKey?: (item: T) => string;
  children: (props: GridItemProps<T>) => JSX.Element;
  itemHeight?: number;
  itemWidth?: number;
  itemOffset?: number;
  columns?: number;
  looping?: boolean;
  /** `touch` binds direct manipulation (drag/wheel) on a pointer host. */
  scroll?: 'auto' | 'none' | 'touch';
  selected?: number;
  onSelectedChanged?: (
    index: number,
    grid: ElementNode,
    elm?: ElementNode,
  ) => void;
}

export function Grid<T>(props: GridProps<T>): JSX.Element {
  const [focusedIndex, setFocusedIndex] = createSignal(0);
  const touch =
    supportsTouchScroll() &&
    (props.scroll === 'touch' ||
      (props.scroll === undefined && defaultTouchScroll()));
  let touchBinding: TouchScrollBinding | undefined;
  const baseColumns = 4;
  const indexByKey = createMemo(() =>
    keyIndex(props.items, props.itemKey, 'Grid'),
  );

  createEffect(() => {
    const currentIndex = untrack(focusedIndex);
    if (props.selected === currentIndex) return;
    if (props.selected !== undefined && props.items?.length > props.selected) {
      moveFocus(props.selected - currentIndex);
    }
  });

  const itemWidth = () => props.itemWidth ?? 300;
  const itemHeight = () => props.itemHeight ?? 300;

  const columns = createMemo(() => props.columns || baseColumns);
  const totalWidth = createMemo(() => itemWidth() + (props.itemOffset ?? 0));
  const totalHeight = createMemo(() => itemHeight() + (props.itemOffset ?? 0));
  const rows = createMemo(() => Math.ceil(props.items.length / columns()));

  function focus() {
    if (!props.items || props.items.length === 0) return false;
    // Removing entries must not leave the grid pointing past the end: focus
    // the last remaining item, as tvOS moves focus to a nearby item when the
    // focused one disappears.
    const index = Math.min(Math.max(focusedIndex(), 0), props.items.length - 1);
    if (index !== focusedIndex()) setFocusedIndex(index);
    const focusedElm = gridRef.children[index];
    if (focusedElm instanceof ElementNode && !hasFocus(focusedElm)) {
      focusedElm.setFocus();
      touchBinding?.reveal(focusedElm, 180);
      props.onSelectedChanged?.call(gridRef, index, gridRef, focusedElm);
      return true;
    }
    return false;
  }

  function moveFocus(delta: number) {
    if (!props.items || props.items.length === 0) return false;
    const newIndex = focusedIndex() + delta;

    if (newIndex >= 0 && newIndex < props.items.length) {
      setFocusedIndex(newIndex);
    } else if (props.looping) {
      const totalItems = props.items.length;
      if (delta < 0) {
        const lastRowStart =
          totalItems - (totalItems % columns()) || totalItems - columns();
        const target = lastRowStart + (focusedIndex() % columns());
        setFocusedIndex(target < totalItems ? target : target - columns());
      } else {
        setFocusedIndex(focusedIndex() % columns());
      }
    } else {
      return false;
    }
    return focus();
  }

  function handleHorizontalFocus(delta: number) {
    if (!props.items || props.items.length === 0) return false;
    const newIndex = focusedIndex() + delta;
    const isWithinRow =
      Math.floor(newIndex / columns()) ===
      Math.floor(focusedIndex() / columns());

    if (newIndex >= 0 && newIndex < props.items.length && isWithinRow) {
      setFocusedIndex(newIndex);
    } else if (props.looping) {
      const rowStart = Math.floor(focusedIndex() / columns()) * columns();
      const rowEnd = Math.min(rowStart + columns() - 1, props.items.length - 1);
      setFocusedIndex(
        delta > 0
          ? newIndex > rowEnd
            ? rowStart
            : newIndex
          : newIndex < rowStart
            ? rowEnd
            : newIndex,
      );
    } else {
      return false;
    }
    return focus();
  }

  // Handle focus when items change - important for autofocus
  createEffect(() => {
    if (props.items && props.items.length > 0 && gridRef && hasFocus(gridRef)) {
      queueMicrotask(focus);
    }
  });

  // Keep the cursor inside the data. Shrinking the list while the grid is
  // focused would otherwise scroll to a row that no longer exists.
  createEffect(() => {
    const count = props.items?.length ?? 0;
    if (count > 0 && focusedIndex() >= count) setFocusedIndex(count - 1);
  });

  function scrollToIndex(this: ElementNode, index: number) {
    untrack(() => {
      if (!props.items || props.items.length === 0) return;

      if (!hasFocus(gridRef)) {
        gridRef.setFocus();
      }

      const clampedIndex = Math.max(0, Math.min(index, props.items.length - 1));
      setFocusedIndex(clampedIndex);
      queueMicrotask(focus);
    });
  }

  // Focus scrolling follows tvOS: move only when the focused row is not
  // fully inside the clipping band. A fixed per-row jump pinned every row to
  // the top and discarded the context above it.
  const [offset, setOffset] = createSignal(props.y ?? 0);
  const scrollY = () =>
    props.scroll === 'none' || touch ? (props.y ?? 0) : offset();
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

  let gridRef!: ElementNode;
  createEffect(() => {
    if (touch || props.scroll === 'none') return;
    // Depend on the data and the viewport, not on the offset this effect
    // writes (that would feed back into itself).
    focusedIndex();
    columns();
    totalHeight();
    rows();
    viewport();
    if (gridRef === undefined) return;
    let clip: ElementNode | undefined = gridRef.parent;
    while (clip !== undefined && !clip.clipping) clip = clip.parent;
    const rect = screenRect(gridRef);
    const scale = rect.width / Math.max(1, gridRef.width || rect.width);
    const clipTop = clip !== undefined ? screenRect(clip).y : 0;
    const clipHeight =
      clip !== undefined ? clip.height || viewport().height : viewport().height;
    const row = Math.floor(focusedIndex() / columns());
    const rowTop = rect.y + row * totalHeight() * scale;
    // Reveal the focused item, not its slot's trailing gap.
    const rowBottom = rowTop + itemHeight() * scale;
    let next = gridRef.y || 0;
    if (rowTop < clipTop) next += (clipTop - rowTop) / scale;
    else if (rowBottom > clipTop + clipHeight)
      next -= (rowBottom - (clipTop + clipHeight)) / scale;
    const content = totalHeight() * rows() * scale;
    const min = Math.min(0, -(content - clipHeight) / scale);
    next = Math.max(min, Math.min(next, props.y ?? 0));
    if (next !== offset()) setOffset(next);
  });
  onCleanup(() => {
    if (gridRef === undefined) return;
    unregisterFocusKey(gridRef, props.focusKey);
    unregisterItemSource(gridRef);
  });
  return (
    <view
      {...props}
      ref={chainRefs((el) => {
        const node = el as ElementNode;
        gridRef = node;
        registerFocusKey(node, props.focusKey);
        registerItemSource(node, indexByKey);
        if (touch) {
          touchBinding = bindTouchScroll(node, { axis: 'y' });
          // Marks the node as a scroller for the scene pointer: its content
          // is hittable across its clipping ancestor's window, not its own
          // translated box. Column and Row set this in their bindings.
          (node as unknown as { scrollAxis?: 'x' | 'y' }).scrollAxis = 'y';
        }
      }, props.ref)}
      transition={/* @once */ { y: true }}
      onPointerDrag={
        /* @once */ touch
          ? chainFunctions(props.onPointerDrag, drag)
          : props.onPointerDrag
      }
      onPointerScroll={
        /* @once */ touch
          ? chainFunctions(props.onPointerScroll, dragWheel)
          : props.onPointerScroll
      }
      onLayout={
        /* @once */ touch
          ? chainFunctions(props.onLayout, layoutTouch)
          : props.onLayout
      }
      height={totalHeight() * rows()}
      scrollToIndex={/* @once */ scrollToIndex}
      onUp={chainFunctions(props.onUp, () => moveFocus(-columns()))}
      onDown={chainFunctions(props.onDown, () => moveFocus(columns()))}
      onLeft={chainFunctions(props.onLeft, () => handleHorizontalFocus(-1))}
      onRight={chainFunctions(props.onRight, () => handleHorizontalFocus(1))}
      onFocus={chainFunctions(props.onFocus, () => handleHorizontalFocus(0))}
      // A touch scroller owns `y` directly; a focus scroller writes it from
      // the focused row. Do not render a competing `y` in touch mode, or the
      // next item update would snap the content back to the top.
      {...(touch ? {} : { y: scrollY() })}
    >
      <Index each={props.items}>
        {(item, index) => {
          const node = (
            <props.children
              item={item()}
              index={index}
              width={itemWidth()}
              height={itemHeight()}
              x={(index % columns()) * totalWidth()}
              y={Math.floor(index / columns()) * totalHeight()}
            />
          ) as unknown;
          if (isElementNode(node) && props.itemKey !== undefined) {
            const itemKey = props.itemKey;
            createRenderEffect(() => setItemKey(node, itemKey(item())));
          }
          return node as JSX.Element;
        }}
      </Index>
    </view>
  );
}
