import { For, type JSX } from 'solid-js';
import type { Rect } from '../sdk/input.js';
import { Popover, type PopoverPlacement } from './Popover.jsx';

export interface MenuItem {
  label: string;
  onSelect?(): void;
  disabled?: boolean;
}

export interface MenuProps {
  visible: boolean | (() => boolean);
  anchor: Rect | (() => Rect);
  items: MenuItem[];
  label?: string;
  placement?: PopoverPlacement;
  onRequestClose?(): void;
  children?: JSX.Element;
}

/**
 * List of actions anchored to a control. This is the Flutter `PopupMenuButton`
 * / Radix DropdownMenu shape: each row activates on Enter, click or touch, and
 * selecting an item closes the menu.
 */
export function Menu(props: MenuProps): JSX.Element {
  const rowHeight = 56;
  return (
    <Popover
      visible={props.visible}
      anchor={props.anchor}
      placement={props.placement}
      label={props.label ?? 'Menu'}
      role="menu"
      height={Math.min(480, props.items.length * rowHeight + 16)}
      onRequestClose={props.onRequestClose}
    >
      <For each={props.items}>
        {(item, index) => {
          const select = () => {
            if (item.disabled) return;
            item.onSelect?.();
            props.onRequestClose?.();
          };
          return (
            <view
              x={0}
              y={8 + index() * rowHeight}
              width={280}
              height={rowHeight}
              color={item.disabled ? 0x1d2937ff : 0x2f3d4eff}
              role="menuitem"
              ariaDisabled={item.disabled}
              onEnter={select}
              onMouseClick={select}
            >
              <text x={18} y={16} fontSize={22} color={item.disabled ? 0x5b6b7cff : 0xf2f6faff}>
                {item.label}
              </text>
            </view>
          );
        }}
      </For>
      {props.children}
    </Popover>
  );
}
