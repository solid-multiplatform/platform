import { For, type JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import type { NodeStyles } from '../core/intrinsicTypes.js';
import { supports } from '../sdk/capabilities.js';
import { useTheme } from '../sdk/theme.jsx';
import type { Rect } from '../sdk/input.js';
import { Column } from './Column.jsx';
import { Popover, type PopoverPlacement } from './Popover.jsx';

export interface MenuItem {
  label: string;
  onSelect?(): void;
  disabled?: boolean;
  /** Drawn in the destructive colour; a context menu puts these last. */
  destructive?: boolean;
  /** The current choice of a select: marked with an accent bar. */
  checked?: boolean;
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



/**
 * List of actions anchored to a control. This is the Flutter `PopupMenuButton`
 * / Radix DropdownMenu shape: Up and Down move between the rows, each row
 * activates on Enter, click or touch, and selecting an item closes the menu.
 * A disabled row is passed over.
 */
export function Menu(props: MenuProps): JSX.Element {
  // A ten-foot menu is larger than a pointer menu; the box, rows and type
  // scale together so the same items stay readable across the room.
  const theme = useTheme();
  const itemStyle = (): NodeStyles => ({
    color: theme.colors.surfaceRaised,
    $focus: { color: theme.colors.primary },
  });
  const disabledStyle = (): NodeStyles => ({ color: theme.colors.surface });
  const tv = supports('remote');
  const rowHeight = tv ? 72 : 56;
  const width = tv ? 420 : 280;
  const fontSize = tv ? 30 : 22;
  const maxPanel = tv ? 640 : 480;
  // The panel never grows past its cap: the list scrolls (focus keeps the
  // selected row visible) instead of painting rows over the panel edge.
  const rows = () =>
    Math.max(
      1,
      Math.min(props.items.length, Math.floor((maxPanel - 16) / rowHeight)),
    );
  const panelHeight = () => rows() * rowHeight + 16;
  let list: ElementNode | undefined;
  return (
    <Popover
      visible={props.visible}
      anchor={props.anchor}
      placement={props.placement}
      label={props.label ?? 'Menu'}
      role="menu"
      height={panelHeight()}
      initialFocus={() => list}
      onRequestClose={props.onRequestClose}
    >
      <Column
        ref={(node) => {
          list = node;
        }}
        x={0}
        y={8}
        width={width}
        height={rows() * rowHeight}
        gap={0}
        scroll="edge"
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
                width={width}
                height={rowHeight}
                style={item.disabled ? disabledStyle() : itemStyle()}
                skipFocus={item.disabled}
                role="menuitem"
                ariaLabel={item.label}
                ariaDisabled={item.disabled}
                onEnter={select}
                onMouseClick={select}
              >
                {/* Always present: a conditional child leaves an empty text
                    placeholder in the scene, and the bar costs nothing. */}
                <view
                  skipFocus
                  x={7}
                  y={rowHeight / 2 - 9}
                  width={4}
                  height={18}
                  borderRadius={2}
                  color={theme.colors.primary}
                  alpha={item.checked ? 1 : 0}
                />
                <text
                  x={22}
                  y={tv ? 22 : 16}
                  width={width - 40}
                  contain="width"
                  fontSize={fontSize}
                  color={
                    item.disabled
                      ? theme.colors.textMuted
                      : item.destructive
                        ? theme.colors.danger
                        : theme.colors.text
                  }
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
