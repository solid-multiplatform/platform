import { For } from '@solid-multiplatform/platform';
import type { ScreenProps } from '../screen';
export function Home(p: ScreenProps) {
  return (
    <view width={p.viewport().width} height={p.viewport().height}>
      <text x={32} y={32} fontSize={28}>
        {p.message()}
      </text>
      <For each={p.names}>
        {(name, i) => (
          <view
            ref={(v) => p.register(name, v)}
            x={32}
            y={96 + i() * 64}
            width={280}
            height={52}
            color={0x243145ff}
            $focus={{ color: 0x385f92ff }}
            autofocus={i() === 0}
            onEnter={() => p.activate(name)}
            onDown={() => p.next(1)}
            onUp={() => p.next(-1)}
          >
            <text x={12} y={8} fontSize={24}>
              {name}
            </text>
          </view>
        )}
      </For>
    </view>
  );
}
