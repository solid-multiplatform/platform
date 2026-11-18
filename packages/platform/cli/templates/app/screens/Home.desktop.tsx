import { For } from '@solid-multiplatform/platform';
import { useMouse } from '@solid-multiplatform/platform/primitives';
import type { ScreenProps } from '../screen';
export function Home(p: ScreenProps) {
  // SDL3 pointer events reach the scene through the host; useMouse adds
  // hover-to-focus, press state and click activation without per-app code.
  useMouse();
  const rail = () => Math.min(240, p.viewport().width * 0.35);
  return (
    <view width={p.viewport().width} height={p.viewport().height}>
      <view width={rail()} height={p.viewport().height} color={0x142235ff}>
        <For each={p.names}>
          {(name, i) => (
            <view
              ref={(v) => p.register(name, v)}
              x={8}
              y={16 + i() * 48}
              width={rail() - 16}
              height={42}
              autofocus={i() === 0}
              style={{ color: 0x243145ff, $focus: { color: 0x385f92ff } }}
              onEnter={() => p.activate(name)}
              onUp={() => p.next(-1)}
              onDown={() => p.next(1)}
            >
              <text x={12} y={6} fontSize={22}>
                {name}
              </text>
            </view>
          )}
        </For>
      </view>
      <text
        x={rail() + 24}
        y={24}
        width={Math.max(0, p.viewport().width - rail() - 48)}
        fontSize={28}
      >
        {p.message()}
      </text>
    </view>
  );
}
