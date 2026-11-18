import { For } from '@solid-multiplatform/platform';
import { Column } from '@solid-multiplatform/platform/primitives';
import { viewport } from '@solid-multiplatform/platform/viewport';
import type { ScreenProps } from '../screen';
export function Home(p: ScreenProps) {
  const rail = () => Math.min(240, viewport().width * 0.35);
  return (
    <view width={viewport().width} height={viewport().height}>
      <view width={rail()} height={viewport().height} color={0x142235ff}>
        <Column x={8} y={16} gap={6} scroll="none" wrap autofocus>
          <For each={p.names}>
            {(name) => (
              <view
                width={rail() - 16}
                height={42}
                style={{ color: 0x243145ff, $focus: { color: 0x385f92ff } }}
                onEnter={() => p.onRun(name)}
              >
                <text x={12} y={6} fontSize={22}>
                  {name}
                </text>
              </view>
            )}
          </For>
        </Column>
      </view>
      <text
        x={rail() + 24}
        y={24}
        width={Math.max(0, viewport().width - rail() - 48)}
        fontSize={28}
      >
        {p.message}
      </text>
    </view>
  );
}
