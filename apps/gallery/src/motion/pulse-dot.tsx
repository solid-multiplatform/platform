import { type JSX } from 'solid-js';
import { createPulse } from './pulse';

/**
 * SwiftUI's `phaseAnimator` on one property: a small dot that breathes a few
 * times when a screen appears and then settles, so an idle screen schedules
 * nothing. Reduce Motion draws it still.
 */
export function PulseDot(props: {
  x?: number;
  y?: number;
  size?: number;
  color: number;
}): JSX.Element {
  const size = () => props.size ?? 8;
  const pulse = createPulse({ phases: 2, duration: 620, cycles: 3 });
  // 0.8 → 1.12 → 0.8 across two phases: out and back, twice.
  const scale = () =>
    pulse.phase() === 0
      ? 0.8 + 0.32 * pulse.progress()
      : 1.12 - 0.32 * pulse.progress();
  return (
    <view
      x={props.x}
      y={props.y}
      width={size()}
      height={size()}
      borderRadius={size() / 2}
      color={props.color}
      scale={scale()}
    />
  );
}
