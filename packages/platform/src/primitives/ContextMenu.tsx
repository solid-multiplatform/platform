import type { JSX } from 'solid-js';
import type { Rect } from '../sdk/input.js';
import { Menu, type MenuItem } from './Menu.jsx';

export interface ContextMenuProps {
  visible: boolean | (() => boolean);
  /** Where the secondary click was, in scene units. */
  point: Rect | (() => Rect);
  items: MenuItem[];
  label?: string;
  onRequestClose?(): void;
}

/**
 * The menu a secondary click (right click, Control-click, a trackpad's
 * secondary click) opens at the pointer. It is a {@link Menu} anchored to the
 * point, so Up/Down move between items, Enter chooses, Escape or a click
 * outside closes it, and focus returns to whatever had it before.
 *
 * Apple's guidance for Context menus (macOS and iPadOS) differs from a
 * regular menu in two ways this component applies: unavailable items are
 * hidden rather than dimmed, and destructive items go last (the caller orders
 * them) in the destructive colour. An app opens it from a node's
 * `onPointerContext` handler:
 *
 * ```tsx
 * const [at, setAt] = createSignal<Rect>();
 * const open = (point: { x: number; y: number }) =>
 *   setAt({ ...point, width: 0, height: 0 });
 * // A secondary click on a pointer host; a long press on a touch host.
 * <view
 *   onPointerContext={open}
 *   onPointerHold={(_node, point) => point && open(point)}
 * />
 * <ContextMenu visible={at()} point={at} items={items} onRequestClose={() => setAt()} />
 * ```
 */
export function ContextMenu(props: ContextMenuProps): JSX.Element {
  // Unavailable items are hidden, as Apple asks for context menus; the
  // destructive commands go last, in a group of their own, as macOS and
  // iPadOS do.
  const items = () => {
    const available = props.items.filter((item) => item.disabled !== true);
    return [
      ...available.filter((item) => item.destructive !== true),
      ...available.filter((item) => item.destructive === true),
    ];
  };
  return (
    <Menu
      visible={props.visible}
      anchor={props.point}
      placement="bottom"
      label={props.label ?? 'Context menu'}
      items={items()}
      onRequestClose={props.onRequestClose}
    />
  );
}
