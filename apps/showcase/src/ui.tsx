/** The few pieces every screen shares. Plain views: `onEnter` and `$focus`. */
import type { JSX } from 'solid-js';
import type { ElementNode, NodeStyles } from '@solid-multiplatform/platform';
import { Column } from '@solid-multiplatform/platform/primitives';
import { viewport } from '@solid-multiplatform/platform/viewport';
import { useShowcase } from './env';
import { metricsFor } from './layout';

export const BACKGROUND = 0x0b1118ff;
export const PANEL = 0x142235ff;
export const TEXT = 0xf2f6faff;
export const MUTED = 0x9fb0c3ff;
export const ACCENT = 0x4fb3ffff;

/** The window class and its numbers, from the reactive viewport. */
export const metrics = () => metricsFor(viewport().width);

/** Width of a screen's content. */
export const contentWidth = () =>
  Math.max(280, viewport().width - 2 * metrics().margin);

/** Focus from the remote, hover and press from a pointer: no plumbing. */
export const interactive: NodeStyles = {
  color: 0x243145ff,
  borderRadius: 8,
  $focus: { color: 0x385f92ff },
  $hover: { color: 0x2d405cff },
  $pressed: { color: 0x4f7fc0ff },
};

export function Button(props: {
  label: string;
  width?: number;
  /** Takes focus when it mounts, instead of the container choosing a row. */
  autofocus?: boolean;
  onEnter?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  ref?: (node: ElementNode) => void;
}) {
  // On a phone a button fills the column unless it asked for less.
  const width = () =>
    Math.min(
      props.width ?? (metrics().layout === 'mobile' ? contentWidth() : 280),
      contentWidth(),
    );
  return (
    <view
      ref={(node: ElementNode) => props.ref?.(node)}
      width={width()}
      height={48}
      style={interactive}
      autofocus={props.autofocus}
      onEnter={() => props.onEnter?.()}
      onFocus={() => props.onFocus?.()}
      onBlur={() => props.onBlur?.()}
    >
      <text x={16} y={10} fontSize={22} color={TEXT}>
        {props.label}
      </text>
    </view>
  );
}

/** A caption above a demo; never a focus target. */
export function Caption(props: { x?: number; y?: number; children: string }) {
  return (
    <text
      skipFocus
      x={props.x ?? 0}
      y={props.y ?? 0}
      fontSize={18}
      color={MUTED}
    >
      {props.children}
    </text>
  );
}

/**
 * A screen: its title, then a column whose first row is Back. Every row is
 * reached with Up/Down and Enter, and by pointer; the Back key works anywhere
 * (the app's root handles it). Demo blocks that take no focus pass
 * `skipFocus`.
 */
export function Screen(props: {
  title: string;
  gap?: number;
  /** Modals and other portals: kept out of the column's rows. */
  overlays?: JSX.Element;
  children?: JSX.Element;
}) {
  const showcase = useShowcase();
  // The header condenses on a phone: a smaller title nearer the top, and the
  // content column starts higher.
  return (
    <view width={viewport().width} height={viewport().height}>
      <text
        x={metrics().margin}
        y={metrics().titleY}
        fontSize={metrics().titleSize}
        color={TEXT}
      >
        {props.title}
      </text>
      <Column
        x={metrics().margin}
        y={metrics().screenBodyY}
        width={contentWidth()}
        gap={props.gap ?? (metrics().layout === 'mobile' ? 10 : 12)}
        scroll="none"
        autofocus
      >
        <Button label="Back" width={160} onEnter={() => showcase.back()} />
        {props.children}
      </Column>
      {props.overlays}
    </view>
  );
}

/** Where a node is in the scene, for anchoring a menu or a tooltip to it. */
export function sceneRect(node: ElementNode) {
  let x = 0;
  let y = 0;
  for (let at: ElementNode | undefined = node; at; at = at.parent) {
    x += at.x ?? 0;
    y += at.y ?? 0;
  }
  return { x, y, width: node.width ?? 0, height: node.height ?? 0 };
}
