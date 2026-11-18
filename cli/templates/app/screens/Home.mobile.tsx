import { For } from '@solid-multiplatform/platform';
import type { ScreenProps } from '../screen';
export function Home(p: ScreenProps) {
  const left = () => 16 + p.viewport().safeArea.left,
    top = () => 16 + p.viewport().safeArea.top;
  const w = () =>
    Math.max(0, p.viewport().width - left() - 16 - p.viewport().safeArea.right);
  return (
    <view width={p.viewport().width} height={p.viewport().height}>
      <text x={left()} y={top()} width={w()} fontSize={24}>
        {p.message()}
      </text>
      <For each={p.names}>
        {(name, i) => (
          <view
            ref={(v) => p.register(name, v)}
            x={left()}
            y={top() + 64 + i() * 58}
            width={w()}
            height={50}
            color={0x243145ff}
            $focus={{ color: 0x385f92ff }}
            onEnter={() => p.activate(name)}
          >
            <text x={12} y={10} fontSize={21}>
              {name}
            </text>
          </view>
        )}
      </For>
    </view>
  );
}
