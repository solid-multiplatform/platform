import { createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import type { ElementNode } from '@solid-multiplatform/platform';
import type { Album } from '../data';
import { Cover } from '../components/Cover';
import { heroEase, lerp } from './ease';

/** A rect in scene units: what matched geometry interpolates. */
export interface HeroRect {
  x: number;
  y: number;
  size: number;
}

/**
 * A node's box in the scene's coordinates: walk the parents summing each
 * offset. The scene has one root, and a scrolled Row moves its children's
 * `x`, so the sum is what the eye sees.
 */
export function rectOf(node: ElementNode | undefined): HeroRect | undefined {
  if (node === undefined) return undefined;
  let x = 0;
  let y = 0;
  for (let n: ElementNode | undefined = node; n; n = n.parent) {
    x += n.x || 0;
    y += n.y || 0;
  }
  const size = Math.min(node.width || 0, node.height || 0);
  if (size <= 0) return undefined;
  return { x: Math.round(x), y: Math.round(y), size: Math.round(size) };
}

/**
 * The floating view of a matched-geometry transition ("hero"): it starts at
 * the rect the source element occupied and lands on the destination's own
 * rect, growing or shrinking as it goes. The two screens are mounted and
 * unmounted by the router, so the moving view is a clone of the same content
 * rather than the source node: the generated `Cover` draws identically at any
 * size.
 *
 * One rAF loop, only while the flight runs; it stops on cleanup.
 */
export function HeroFlight(props: {
  album: Album;
  from: HeroRect;
  to: HeroRect;
  duration?: number;
  onDone?(): void;
}): JSX.Element {
  const [t, setT] = createSignal(0);
  onMount(() => {
    const duration = props.duration ?? 420;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / duration));
      setT(heroEase(p));
      if (p < 1) frame = requestAnimationFrame(step);
      else props.onDone?.();
    };
    frame = requestAnimationFrame(step);
    onCleanup(() => cancelAnimationFrame(frame));
  });
  const rect = () => ({
    x: lerp(props.from.x, props.to.x, t()),
    y: lerp(props.from.y, props.to.y, t()),
    size: lerp(props.from.size, props.to.size, t()),
  });
  return (
    <view
      x={rect().x}
      y={rect().y}
      width={rect().size}
      height={rect().size}
      zIndex={600}
      clipping
    >
      <Cover album={props.album} size={rect().size} radius={12} />
    </view>
  );
}
