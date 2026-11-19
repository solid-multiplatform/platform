import { For } from '@solid-multiplatform/platform';
import { Column, Row } from '@solid-multiplatform/platform/primitives';
import type { ScreenProps } from '../screen';
export function Home(p: ScreenProps) {
  // Five tiles to a row.
  const rows = () =>
    p.names.reduce<string[][]>((rows, name, i) => {
      if (i % 5 === 0) rows.push([]);
      rows[rows.length - 1]!.push(name);
      return rows;
    }, []);
  return (
    <view width={1920} height={1080}>
      <text x={90} y={70} fontSize={54}>
        {p.message}
      </text>
      <Column x={90} y={220} gap={28} scroll="none" plinko wrap autofocus>
        <For each={rows()}>
          {(names) => (
            <Row height={132} gap={24} scroll="none" wrap>
              <For each={names}>
                {(name) => (
                  <view
                    width={312}
                    height={132}
                    style={{ color: 0x253040ff, $focus: { color: 0x31609bff } }}
                    onEnter={() => p.onRun(name)}
                  >
                    <text x={20} y={44} fontSize={32}>
                      {name}
                    </text>
                  </view>
                )}
              </For>
            </Row>
          )}
        </For>
      </Column>
    </view>
  );
}
