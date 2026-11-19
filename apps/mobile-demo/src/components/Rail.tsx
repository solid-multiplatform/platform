/** A horizontal poster rail: drag with momentum, snap to card + gutter. */
import { For } from 'solid-js';
import type { Title } from '../catalog';
import type { Scroller } from '../scroller';
import type { Metrics } from '../theme';
import { PosterCard } from './PosterCard';
import { SkeletonRail } from './Skeleton';

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

  // A drag that starts on a card picks one axis after the first few units:
  // horizontal moves the rail, vertical moves the page underneath.
  let mode: 'h' | 'v' | null = null;
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
      const dx = Math.abs(point.x - originX);
      const dy = Math.abs(point.y - originY);
      if (dx < 2 && dy < 2) return;
      mode = dx >= dy ? 'h' : 'v';
      if (mode === 'h') {
        props.scroller.dragAxis('start', originX);
        props.scroller.dragAxis('move', point.x);
      } else {
        props.page.dragAxis('start', originY);
        props.page.dragAxis('move', point.y);
      }
      return;
    }
    if (mode === 'h') props.scroller.dragAxis(phase, point.x);
    else if (mode === 'v') props.page.dragAxis(phase, point.y);
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
