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
 * The content is laid out once, at the source's size, and the flight only
 * moves and scales that box: resizing the cover every frame would re-lay-out
 * and re-rasterise its lettering and rules 60 times a second, which is what
 * made the first version of this stutter. Scaling keeps every glyph and
 * texture exactly as it was drawn (SDF text scales cleanly, which is the
 * same reason SwiftUI can snapshot a view and interpolate its frame).
 *
 * One rAF loop, only while the flight runs; it stops on cleanup.
 */
export function HeroFlight(props: {
  album: Album;
  from: HeroRect;
  to: HeroRect;
  duration?: number;
  /** The corner radius the cover lands with, in screen units. */
  radius?: number;
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
  // Fixed layout box, in source units; only the transform changes. The
  // corner radius is divided by the same scale so it stays the size it lands
  // with instead of growing with the box.
  const base = () => props.from.size;
  const grew = () => lerp(1, props.to.size / base(), t());
  const radius = () => (props.radius ?? 14) / grew();
  const centre = () => ({
    x: lerp(props.from.x + base() / 2, props.to.x + props.to.size / 2, t()),
    y: lerp(props.from.y + base() / 2, props.to.y + props.to.size / 2, t()),
  });
  return (
    <view
      x={centre().x - base() / 2}
      y={centre().y - base() / 2}
      width={base()}
      height={base()}
      scale={grew()}
      zIndex={600}
    >
      <Cover album={props.album} size={base()} radius={radius()} />
    </view>
  );
}
