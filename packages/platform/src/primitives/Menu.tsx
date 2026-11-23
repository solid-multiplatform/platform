import { For, Show, type JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import type { NodeStyles } from '../core/intrinsicTypes.js';
import { supports } from '../sdk/capabilities.js';
import { selectionFeedback } from '../sdk/device.js';
import { useUiScale } from '../sdk/layout.js';
import { useTheme } from '../sdk/theme.jsx';
import { viewport } from '../sdk/viewport.js';
import type { Rect } from '../sdk/input.js';
import { Column } from './Column.jsx';
import { CheckIcon } from './icons.jsx';
import { Popover, type PopoverPlacement } from './Popover.jsx';

export interface MenuItem {
  label?: string;
  onSelect?(): void;
  disabled?: boolean;
  /** Drawn in the destructive colour; a context menu puts these last. */
  destructive?: boolean;
  /** The current choice of a select: marked with a leading check. */
  checked?: boolean;
  /** A hairline between groups; never takes focus. */
  separator?: boolean;
  /** A command shortcut shown trailing, e.g. `⌘S`. */
  shortcut?: string;
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
 * A disabled row is passed over; a separator is a hairline that never takes
 * focus; a shortcut is trailing text (the app owns the key binding).
 */
export function Menu(props: MenuProps): JSX.Element {
  // A ten-foot menu is larger than a pointer menu; the box, rows and type
  // scale together so the same items stay readable across the room.
  const theme = useTheme();
  const scale = useUiScale();
  const u = (value: number) => Math.round(value * scale);
  // Rows are quiet until they are reached: the focused row takes the app's
  // selection tint, the way every other list in the framework does, instead
  // of a solid accent block under the label.
  const itemStyle = (): NodeStyles => ({
    color: 0x00000000,
    borderRadius: u(theme.radius.small),
    $focus: { color: theme.colors.selection },
  });
  const disabledStyle = (): NodeStyles => ({ color: 0x00000000 });
  const tv = supports('remote');
  const rowHeight = u(tv ? 72 : 56);
  const separatorHeight = u(tv ? 18 : 11);
  const safe = viewport().insets.safeArea;
  const availableWidth = viewport().width - safe.left - safe.right;
  const availableHeight =
    viewport().height -
    safe.top -
    Math.max(safe.bottom, viewport().insets.ime.bottom);
  // A phone cannot take a 280-unit menu on a 390-unit screen with margins;
  // a short landscape window cannot take a 480-unit menu either.
  const width = Math.max(180, Math.min(tv ? 420 : 280, availableWidth - 48));
  const fontSize = u(tv ? 30 : 17);
  const shortcutSize = u(tv ? 22 : 13);
  const checkSize = u(tv ? 22 : 16);
  const checkX = u(tv ? 16 : 12);
  const textX = u(tv ? 50 : 38);
  const maxPanel = Math.min(u(tv ? 640 : 480), availableHeight - u(32));

  const heights = () =>
    props.items.map((item) => (item.separator ? separatorHeight : rowHeight));
  // The panel never grows past its cap: the list scrolls (focus keeps the
  // selected row visible) instead of painting rows over the panel edge.
  const window = () => {
    const all = heights();
    let used = 0;
    let count = 0;
    for (const height of all) {
      if (count > 0 && used + height > maxPanel - u(16)) break;
      used += height;
      count++;
    }
    return { count: Math.max(1, count), height: used };
  };
  const panelHeight = () => window().height + u(16);
  const visible = () => props.items.slice(0, window().count);
  // Opening focus must land on an actionable row: if the current choice is
  // disabled (or a separator), scan forward, then backward, for a neighbour.
  const initialSelected = () => {
    const wanted = props.selected ?? 0;
    const usable = (index: number) => {
      const item = props.items[index];
      return item !== undefined && !item.disabled && item.separator !== true;
    };
    if (usable(wanted)) return wanted;
    for (let i = wanted + 1; i < props.items.length; i++)
      if (usable(i)) return i;
    for (let i = wanted - 1; i >= 0; i--) if (usable(i)) return i;
    return wanted;
  };
  let list: ElementNode | undefined;
  return (
    <Popover
      visible={props.visible}
      anchor={props.anchor}
      placement={props.placement}
      label={props.label ?? 'Menu'}
      role="menu"
      // The panel is as wide as the rows it holds: on a TV the 420-unit rows
      // otherwise spill 140 units past the popover's 280-unit background.
      width={width}
      height={panelHeight()}
      initialFocus={() => list}
      onRequestClose={props.onRequestClose}
    >
      <Column
        ref={(node) => {
          list = node;
        }}
        x={0}
        y={u(8)}
        width={width}
        height={window().height}
        gap={0}
        scroll="edge"
        selected={initialSelected()}
        role="none"
      >
        <For each={visible()}>
          {(item, index) => {
            const height = () => heights()[index()] ?? rowHeight;
            const select = () => {
              if (item.disabled || item.separator) return;
              void selectionFeedback();
              item.onSelect?.();
              props.onRequestClose?.();
            };
            return (
              <Show
                when={item.separator !== true}
                fallback={
                  <view
                    width={width}
                    height={height()}
                    skipFocus
                    role="separator"
                    ariaLabel="Separator"
                  >
                    <view
                      skipFocus
                      x={u(12)}
                      y={height() / 2}
                      width={width - u(24)}
                      height={1}
                      color={theme.colors.border}
                    />
                  </view>
                }
              >
                <view
                  width={width}
                  height={height()}
                  borderRadius={u(theme.radius.small)}
                  style={item.disabled ? disabledStyle() : itemStyle()}
                  skipFocus={item.disabled}
                  role="menuitem"
                  ariaLabel={item.label ?? ''}
                  ariaDisabled={item.disabled}
                  onEnter={select}
                  onMouseClick={select}
                >
                  {/* Apple marks the current choice with a check in a leading
                      gutter. Always present (a conditional child leaves an
                      empty placeholder in the scene), transparent when not
                      checked. */}
                  <view
                    skipFocus
                    x={checkX}
                    y={height() / 2 - checkSize / 2}
                    width={checkSize}
                    height={checkSize}
                    alpha={item.checked ? 1 : 0}
                  >
                    <CheckIcon size={checkSize} color={theme.colors.primary} />
                  </view>
                  <text
                    x={textX}
                    y={(height() - fontSize * 1.2) / 2}
                    width={width - textX - (item.shortcut ? u(82) : u(18))}
                    contain="width"
                    maxLines={1}
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
                  <Show when={item.shortcut !== undefined}>
                    <text
                      skipFocus
                      x={width - u(82)}
                      y={(height() - shortcutSize * 1.2) / 2}
                      width={u(70)}
                      textAlign="right"
                      contain="width"
                      maxLines={1}
                      fontSize={shortcutSize}
                      color={theme.colors.textMuted}
                    >
                      {item.shortcut}
                    </text>
                  </Show>
                </view>
              </Show>
            );
          }}
        </For>
      </Column>
      {props.children}
    </Popover>
  );
}
