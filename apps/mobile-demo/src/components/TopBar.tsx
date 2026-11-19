/** The two-mode segmented control that floats over both screens. */
import { C, type Metrics } from '../theme';

const SEGMENTS = [
  { id: 'discover' as const, label: 'Discover' },
  { id: 'chat' as const, label: 'Chat' },
];

export function TopBar(props: {
  metrics: Metrics;
  mode: 'discover' | 'chat';
  meter: boolean;
  onMode: (mode: 'discover' | 'chat') => void;
  onMeter: () => void;
}) {
  const width = () =>
    Math.min(268, props.metrics.width - 2 * props.metrics.margin - 68);
  const segment = () => (width() - 8) / 2;
  return (
    <view
      zIndex={60}
      x={0}
      y={0}
      width={props.metrics.width}
      height={props.metrics.barY + props.metrics.barH + 8}
    >
      <view
        x={props.metrics.margin}
        y={props.metrics.barY}
        width={width()}
        height={props.metrics.barH}
        color={0x141416f2}
        borderRadius={props.metrics.barH / 2}
        border={{ width: 1, color: C.line }}
      >
        {SEGMENTS.map((entry, index) => {
          const active = () => props.mode === entry.id;
          return (
            <view
              x={4 + index * segment()}
              y={4}
              width={segment()}
              height={props.metrics.barH - 8}
              borderRadius={(props.metrics.barH - 8) / 2}
              color={active() ? C.white : 0x00000000}
              onMouseClick={() => props.onMode(entry.id)}
            >
              <text
                y={17}
                width={segment()}
                contain="width"
                textAlign="center"
                fontSize={14}
                color={active() ? C.background : C.muted}
              >
                {entry.label}
              </text>
            </view>
          );
        })}
      </view>
      <view
        x={props.metrics.width - props.metrics.margin - 52}
        y={props.metrics.barY}
        width={52}
        height={props.metrics.barH}
        color={props.meter ? C.accent : 0x141416f2}
        borderRadius={props.metrics.barH / 2}
        border={{ width: 1, color: props.meter ? C.accent : C.line }}
        onMouseClick={() => props.onMeter()}
      >
        <text
          y={21}
          width={52}
          contain="width"
          textAlign="center"
          fontSize={11}
          letterSpacing={0.8}
          color={props.meter ? C.onAccent : C.muted}
        >
          FPS
        </text>
      </view>
    </view>
  );
}
