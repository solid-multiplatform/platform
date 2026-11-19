import { For, type JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import type { NodeStyles } from '../core/intrinsicTypes.js';
import type { Rect } from '../sdk/input.js';
import { Column } from './Column.jsx';
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
  /**
   * Index of the item focus opens on: the current choice of a select. The
   * first item that is not disabled when omitted or disabled itself.
   */
  selected?: number;
  onRequestClose?(): void;
  children?: JSX.Element;
}

const ITEM_STYLE: NodeStyles = {
  color: 0x2f3d4eff,
  $focus: { color: 0x2563ebff },
};
const DISABLED_STYLE: NodeStyles = { color: 0x1d2937ff };

/**
 * List of actions anchored to a control. This is the Flutter `PopupMenuButton`
 * / Radix DropdownMenu shape: Up and Down move between the rows, each row
 * activates on Enter, click or touch, and selecting an item closes the menu.
 * A disabled row is passed over.
 */
export function Menu(props: MenuProps): JSX.Element {
  const rowHeight = 56;
  let list: ElementNode | undefined;
  return (
    <Popover
      visible={props.visible}
      anchor={props.anchor}
      placement={props.placement}
      label={props.label ?? 'Menu'}
      role="menu"
      height={Math.min(480, props.items.length * rowHeight + 16)}
      initialFocus={() => list}
      onRequestClose={props.onRequestClose}
    >
      <Column
        ref={(node) => {
          list = node;
        }}
        x={0}
        y={8}
        width={280}
        height={props.items.length * rowHeight}
        gap={0}
        scroll="none"
        selected={props.selected ?? 0}
        role="none"
      >
        <For each={props.items}>
          {(item) => {
            const select = () => {
              if (item.disabled) return;
              item.onSelect?.();
              props.onRequestClose?.();
            };
            return (
              <view
                width={280}
                height={rowHeight}
                style={item.disabled ? DISABLED_STYLE : ITEM_STYLE}
                skipFocus={item.disabled}
                role="menuitem"
                ariaDisabled={item.disabled}
                onEnter={select}
                onMouseClick={select}
              >
                <text
                  x={18}
                  y={16}
                  fontSize={22}
                  color={item.disabled ? 0x5b6b7cff : 0xf2f6faff}
                >
                  {item.label}
                </text>
              </view>
            );
          }}
        </For>
      </Column>
      {props.children}
    </Popover>
  );
}
