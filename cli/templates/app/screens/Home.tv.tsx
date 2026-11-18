import { For } from '@solid-multiplatform/platform';
import type { ScreenProps } from '../screen';
export function Home(p: ScreenProps) {
  return (
    <view width={1920} height={1080}>
      <text x={90} y={70} fontSize={54}>
        {p.message()}
      </text>
      <For each={p.names}>
        {(name, i) => (
          <view
            ref={(v) => p.register(name, v)}
            x={90 + (i() % 5) * 336}
            y={220 + Math.floor(i() / 5) * 160}
            width={312}
            height={132}
            color={0x253040ff}
            $focus={{ color: 0x31609bff }}
            autofocus={i() === 0}
            onLeft={() => p.next(-1)}
            onRight={() => p.next(1)}
            onUp={() => p.next(-5)}
            onDown={() => p.next(5)}
            onEnter={() => p.activate(name)}
          >
            <text x={20} y={44} fontSize={32}>
              {name}
            </text>
          </view>
        )}
      </For>
    </view>
  );
}
