/** Shimmer placeholders shaped exactly like the rail's real cards. */
import { For, onCleanup, onMount } from 'solid-js';
import type { ElementNode } from '@solid-multiplatform/platform';
import { C } from '../theme';

/** One highlight that sweeps the card while the skeleton is mounted. */
function Sheen(props: { width: number; height: number }) {
  let node: ElementNode | undefined;
  let controller: { stop(): void } | undefined;
  onMount(() => {
    if (!node) return;
    controller = node
      .animate(
        { x: props.width + 80 },
        { duration: 1350, loop: true, easing: 'linear' },
      )
      .start();
  });
  onCleanup(() => controller?.stop());
  return (
    <view
      ref={(el) => (node = el)}
      x={-90}
      y={-30}
      width={72}
      height={props.height + 60}
      color={0x00000000}
      linearGradient={{
        colors: [0xffffff00, 0xffffff1f, 0xffffff00],
        angle: Math.PI / 2,
        stops: [0, 0.5, 1],
      }}
      rotation={16}
    />
  );
}

export function SkeletonCard(props: {
  x: number;
  width: number;
  height: number;
}) {
  return (
    <view x={props.x} y={0} width={props.width} height={props.height}>
      <view
        width={props.width}
        height={props.height}
        color={C.skeleton}
        borderRadius={14}
        clipping
      >
        <Sheen width={props.width} height={props.height} />
      </view>
      <view
        y={props.height + 12}
        width={Math.round(props.width * 0.72)}
        height={11}
        color={C.skeleton}
        borderRadius={6}
      />
    </view>
  );
}

export function SkeletonRail(props: {
  width: number;
  cardWidth: number;
  cardHeight: number;
  gap: number;
}) {
  const count = () =>
    Math.max(3, Math.ceil(props.width / (props.cardWidth + props.gap)) + 1);
  return (
    <view width={props.width} height={props.cardHeight + 30} clipping>
      <For each={Array.from({ length: count() }, (_, index) => index)}>
        {(index) => (
          <SkeletonCard
            x={index * (props.cardWidth + props.gap)}
            width={props.cardWidth}
            height={props.cardHeight}
          />
        )}
      </For>
    </view>
  );
}

/** A whole-rail skeleton, including the section title bar. */
export function SkeletonSection(props: {
  width: number;
  cardWidth: number;
  cardHeight: number;
  gap: number;
}) {
  return (
    <view width={props.width} height={props.cardHeight + 46}>
      <view width={120} height={13} color={C.skeleton} borderRadius={6} y={0} />
      <view y={28}>
        <SkeletonRail
          width={props.width}
          cardWidth={props.cardWidth}
          cardHeight={props.cardHeight}
          gap={props.gap}
        />
      </view>
    </view>
  );
}
