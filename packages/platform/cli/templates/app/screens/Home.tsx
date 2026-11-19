import { For } from '@solid-multiplatform/platform';
import { Column } from '@solid-multiplatform/platform/primitives';
import { viewport } from '@solid-multiplatform/platform/viewport';
import type { ScreenProps } from '../screen';
export function Home(p: ScreenProps) {
  return (
    <view width={viewport().width} height={viewport().height}>
      <text x={32} y={32} fontSize={28}>
        {p.message}
      </text>
      <Column x={32} y={96} gap={12} scroll="none" wrap autofocus>
        <For each={p.names}>
          {(name) => (
            <view
              width={280}
              height={52}
              style={{ color: 0x243145ff, $focus: { color: 0x385f92ff } }}
              onEnter={() => p.onRun(name)}
            >
              <text x={12} y={8} fontSize={24}>
                {name}
              </text>
            </view>
          )}
        </For>
      </Column>
    </view>
  );
}
