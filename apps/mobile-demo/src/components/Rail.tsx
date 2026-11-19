/** A horizontal poster rail: drag with momentum, snap to card + gutter. */
import { createEffect, For } from 'solid-js';
import type { Title } from '../catalog';
import type { Scroller } from '../scroller';
import type { Metrics } from '../theme';
import { PosterCard } from './PosterCard';
import { SkeletonRail } from './Skeleton';

/**
 * Apple's pan hysteresis: 10 pt of movement before a direction is chosen.
 * The lock angles are UIKit's own (decoded from the iOS 26.2 binary): a
 * pan within 20 degrees of an axis locks to it; between the two, a nested
 * scroll view lets both axes scroll at once, so a diagonal drag moves the
 * rail horizontally and the page vertically.
 */
const AXIS_SLOP = 10;
const LOCK_HORIZONTAL = Math.tan((20 * Math.PI) / 180);
const LOCK_VERTICAL = Math.tan((70 * Math.PI) / 180);

export function Rail(props: {
  x: number;
  y: number;
  width: number;
  metrics: Metrics;
  items: Title[] | undefined;
  loading: boolean;
  scroller: Scroller;
  page: Scroller;
  onOpen: (title: Title) => void;
}) {
  const slot = () => props.metrics.cardW + props.metrics.cardGap;
  const first = () =>
    Math.max(0, Math.floor(props.scroller.offset() / slot()) - 1);
  const count = () => Math.ceil(props.width / slot()) + 3;
  const visible = () => (props.items ?? []).slice(first(), first() + count());

  // The rail's content extent: every card at its slot, no trailing gutter.
  createEffect(() => {
    const items = props.items ?? [];
    const content =
      items.length > 0
        ? items.length * slot() - props.metrics.cardGap
        : props.width;
    props.scroller.layout(Math.max(props.width, content), props.width);
  });

  // A drag that starts on a card picks its axes after 10 units of movement:
  // horizontal moves the rail, vertical moves the page underneath, and a
  // diagonal moves both, the way nested scroll views do on iOS.
  let mode: 'h' | 'v' | 'both' | null = null;
  let originX = 0;
  let originY = 0;
  const onDrag = (
    phase: 'start' | 'move' | 'end' | 'cancel',
    point: { x: number; y: number },
    origin: { x: number; y: number },
  ) => {
    if (phase === 'start') {
      mode = null;
      originX = origin.x;
      originY = origin.y;
      return;
    }
    if (mode === null && phase === 'move') {
      const dx = point.x - originX;
      const dy = point.y - originY;
      if (dx * dx + dy * dy < AXIS_SLOP * AXIS_SLOP) return;
      const ratio = Math.abs(dy) / Math.max(1e-6, Math.abs(dx));
      mode =
        ratio <= LOCK_HORIZONTAL ? 'h' : ratio >= LOCK_VERTICAL ? 'v' : 'both';
      // The drag began at the finger's origin, not where the slop ended.
      if (mode === 'h' || mode === 'both')
        props.scroller.dragAxis('start', originX);
      if (mode === 'v' || mode === 'both')
        props.page.dragAxis('start', originY);
    }
    if (mode === 'h' || mode === 'both')
      props.scroller.dragAxis(phase, point.x);
    if (mode === 'v' || mode === 'both') props.page.dragAxis(phase, point.y);
  };

  return (
    <view
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.metrics.cardH + 30}
      clipping
      onPointerDrag={onDrag}
    >
      {props.loading ? (
        <SkeletonRail
          width={props.width}
          cardWidth={props.metrics.cardW}
          cardHeight={props.metrics.cardH}
          gap={props.metrics.cardGap}
        />
      ) : (
        <For each={visible()}>
          {(title, index) => (
            <PosterCard
              title={title}
              x={(first() + index()) * slot() - props.scroller.offset()}
              width={props.metrics.cardW}
              height={props.metrics.cardH}
              onOpen={props.onOpen}
            />
          )}
        </For>
      )}
    </view>
  );
}
