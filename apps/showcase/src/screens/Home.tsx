/** Home: a grid of every section. Arrows move, Enter or a click opens. */
import { createMemo, For } from 'solid-js';
import { Column, Row } from '@solid-multiplatform/platform/primitives';
import { viewport } from '@solid-multiplatform/platform/viewport';
import { useShowcase } from '../env';
import { probeStatus } from '../probe/run';
import { sections, type Section } from '../routes';
import { contentWidth, interactive, metrics, MUTED, TEXT } from '../ui';

const TILE_WIDTH = 280;
const GAP = 16;

// The tile to return to when a section closes.
let lastTile = 0;

export function HomeScreen() {
  const showcase = useShowcase();
  // A phone has one full-width card per row; a desktop window and a
  // television fit as many 280-wide cards as the content width allows.
  const mobile = () => metrics().layout === 'mobile';
  const gap = () => (mobile() ? 12 : GAP);
  const tileWidth = () => (mobile() ? contentWidth() : TILE_WIDTH);
  const columns = () =>
    mobile()
      ? 1
      : Math.max(1, Math.floor((contentWidth() + GAP) / (TILE_WIDTH + GAP)));
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
      <text
        x={metrics().margin}
        y={metrics().titleY}
        fontSize={metrics().titleSize}
        color={TEXT}
      >
        Showcase
      </text>
      <text
        x={metrics().margin}
        y={metrics().subtitleY}
        fontSize={metrics().subtitleSize}
        color={MUTED}
      >
        {`${showcase.env.target}, ${showcase.env.backend}. ${probeStatus()}`}
      </text>
      <Column
        x={metrics().margin}
        y={metrics().homeBodyY}
        width={contentWidth()}
        gap={gap()}
        scroll="none"
        plinko
        autofocus
        selected={startRow}
      >
        <For each={rows()}>
          {(row, rowIndex) => (
            <Row
              height={metrics().tileHeight}
              gap={gap()}
              scroll="none"
              selected={rowIndex() === startRow ? startColumn : 0}
            >
              <For each={row}>
                {(section, columnIndex) => (
                  <view
                    width={tileWidth()}
                    height={metrics().tileHeight}
                    style={interactive}
                    onEnter={() => {
                      lastTile = rowIndex() * columns() + columnIndex();
                      showcase.go(section.path);
                    }}
                  >
                    <text
                      x={mobile() ? 14 : 16}
                      y={mobile() ? 26 : 38}
                      fontSize={mobile() ? 22 : 26}
                      color={TEXT}
                    >
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
