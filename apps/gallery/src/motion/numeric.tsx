import {
  createEffect,
  createSignal,
  onCleanup,
  Show,
  type JSX,
} from 'solid-js';

/**
 * SwiftUI's `contentTransition(.numericText)`: when the value changes the old
 * digits slide up out of the box and the new ones rise into it. The box keeps
 * its size, so nothing around it moves. One rAF run per change, cancelled on
 * cleanup; no change, no scheduling.
 */
export function AnimatedNumber(props: {
  value: number;
  width: number;
  height: number;
  fontSize: number;
  color: number;
  duration?: number;
}): JSX.Element {
  const [shown, setShown] = createSignal(props.value);
  const [leaving, setLeaving] = createSignal<number>();
  const [t, setT] = createSignal(1);
  let frame = 0;

  const run = () => {
    cancelAnimationFrame(frame);
    const duration = props.duration ?? 220;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / duration));
      setT(p);
      if (p < 1) frame = requestAnimationFrame(step);
      else setLeaving(undefined);
    };
    frame = requestAnimationFrame(step);
  };

  createEffect(() => {
    const next = props.value;
    if (next === shown()) return;
    setLeaving(shown());
    setShown(next);
    setT(0);
    run();
  });
  onCleanup(() => cancelAnimationFrame(frame));

  const rise = () => Math.round(props.height * (1 - t()));
  return (
    <view width={props.width} height={props.height} clipping>
      <Show when={leaving() !== undefined}>
        <text
          width={props.width}
          height={props.height}
          y={-rise()}
          fontSize={props.fontSize}
          color={props.color}
          contain="width"
        >
          {String(leaving())}
        </text>
      </Show>
      <text
        width={props.width}
        height={props.height}
        y={rise()}
        fontSize={props.fontSize}
        color={props.color}
        contain="width"
      >
        {String(shown())}
      </text>
    </view>
  );
}
