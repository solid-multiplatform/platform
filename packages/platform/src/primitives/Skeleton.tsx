import { createEffect, onCleanup, type JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import { Config } from '../core/config.js';
import { useTheme } from '../sdk/theme.jsx';
import { chainRefs } from './utils/chainFunctions.js';

export interface SkeletonProps {
  x?: number;
  y?: number;
  width: number;
  height: number;
  /** Corner radius in logical units. Defaults to the theme's medium. */
  radius?: number;
  /**
   * One slow alpha loop, opt-in. A static placeholder is the default and
   * schedules nothing; `pulse` animates a single node only while mounted
   * and follows Reduce Motion/`Config.animationsEnabled`.
   */
  pulse?: boolean;
  /** Read by assistive technology; defaults to "Loading". */
  label?: string;
  ref?: (node: ElementNode) => void;
}

export interface SkeletonTextProps extends Omit<
  SkeletonProps,
  'height' | 'width'
> {
  /** Number of text lines the bars stand in for. Defaults to 3. */
  lines?: number;
  width: number;
}

/** One loop eases down and back up, so the pulse has no snap at either end. */
const triangle = (progress: number): number =>
  progress < 0.5 ? progress * 2 : 2 - progress * 2;

/**
 * A content-shaped placeholder, the `.redacted(reason: .placeholder)` idiom:
 * show something as soon as possible and replace it when the content arrives
 * (HIG, Loading). Draw the skeleton in the same layout the loaded content
 * uses, behind an ordinary `Show`. Blocks take no focus and never hold
 * timers: static by default, and with `pulse` one node animates only while
 * mounted.
 */
export function Skeleton(props: SkeletonProps): JSX.Element {
  const theme = () => useTheme();
  let node: ElementNode | undefined;
  let animation:
    | {
        start(): unknown;
        stop(): unknown;
        restore?(): unknown;
      }
    | undefined;

  createEffect(() => {
    const pulsing = props.pulse === true && Config.animationsEnabled;
    if (node === undefined || !pulsing) {
      animation?.stop();
      animation?.restore?.();
      animation = undefined;
      return;
    }
    if (animation !== undefined) return;
    animation = node.animate(
      { alpha: 0.45 },
      { duration: 900, loop: true, easing: triangle },
    );
    animation.start();
  });
  onCleanup(() => {
    animation?.stop();
    animation?.restore?.();
    animation = undefined;
  });

  return (
    <view
      ref={chainRefs(props.ref, (el) => (node = el))}
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={props.height}
      skipFocus
      role="image"
      ariaLabel={props.label ?? 'Loading'}
      borderRadius={props.radius ?? theme().radius.medium}
      color={theme().colors.border}
    />
  );
}

/**
 * The text counterpart: `lines` bars at the body line height, the last one
 * shorter, the shape a paragraph makes. `width` is the block's width.
 */
export function SkeletonText(props: SkeletonTextProps): JSX.Element {
  const theme = () => useTheme();
  const lines = () => Math.max(1, props.lines ?? 3);
  const lineHeight = () => Math.round(theme().typography.body * 1.35);
  const gap = () => Math.max(4, Math.round(lineHeight() * 0.35));
  return (
    <view
      ref={chainRefs(props.ref)}
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
    >
      {Array.from({ length: lines() }, (_, index) => (
        <Skeleton
          y={index * (lineHeight() + gap())}
          width={
            index === lines() - 1
              ? Math.max(props.width * 0.6, props.width / lines())
              : props.width
          }
          height={lineHeight()}
          radius={theme().radius.small}
          pulse={props.pulse}
          label={props.label}
        />
      ))}
    </view>
  );
}
