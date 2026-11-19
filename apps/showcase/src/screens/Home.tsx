/** Home: a grid of every section. Arrows move, Enter or a click opens. */
import { createMemo, For } from 'solid-js';
import { Column, Row } from '@solid-multiplatform/platform/primitives';
import { viewport } from '@solid-multiplatform/platform/viewport';
import { useShowcase } from '../env';
import { probeStatus } from '../probe/run';
import { sections, type Section } from '../routes';
import { contentWidth, interactive, MARGIN, MUTED, TEXT } from '../ui';

const TILE_WIDTH = 280;
const TILE_HEIGHT = 110;
const GAP = 16;

// The tile to return to when a section closes.
let lastTile = 0;

export function HomeScreen() {
  const showcase = useShowcase();
  const columns = () =>
    Math.max(1, Math.floor((contentWidth() + GAP) / (TILE_WIDTH + GAP)));
  const rows = createMemo(() => {
    const out: Section[][] = [];
    sections.forEach((section, index) => {
      if (index % columns() === 0) out.push([]);
      out[out.length - 1]!.push(section);
    });
    return out;
  });
  const startRow = Math.floor(lastTile / columns());
  const startColumn = lastTile % columns();
  return (
    <view width={viewport().width} height={viewport().height}>
      <text x={MARGIN} y={18} fontSize={34} color={TEXT}>
        Showcase
      </text>
      <text x={MARGIN} y={68} fontSize={18} color={MUTED}>
        {`${showcase.env.target}, ${showcase.env.backend}. ${probeStatus()}`}
      </text>
      <Column
        x={MARGIN}
        y={110}
        gap={GAP}
        scroll="none"
        plinko
        autofocus
        selected={startRow}
      >
        <For each={rows()}>
          {(row, rowIndex) => (
            <Row
              height={TILE_HEIGHT}
              gap={GAP}
              scroll="none"
              selected={rowIndex() === startRow ? startColumn : 0}
            >
              <For each={row}>
                {(section, columnIndex) => (
                  <view
                    width={TILE_WIDTH}
                    height={TILE_HEIGHT}
                    style={interactive}
                    onEnter={() => {
                      lastTile = rowIndex() * columns() + columnIndex();
                      showcase.go(section.path);
                    }}
                  >
                    <text x={16} y={38} fontSize={26} color={TEXT}>
                      {section.title}
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
