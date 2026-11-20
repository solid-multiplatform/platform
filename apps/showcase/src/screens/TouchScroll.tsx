/** Touch scrolling: a snapping rail and a vertical page with a rail inside. */
import { For } from 'solid-js';
import { Column, Row } from '@solid-multiplatform/platform/primitives';
import { contentWidth, interactive, MUTED, Screen, TEXT } from '../ui';

const numbers = (count: number) => Array.from({ length: count }, (_, i) => i);
const CARD = 132;
const GAP = 12;
const CAPTION = 28;
const SWATCHES = [0x243145ff, 0x2d405cff, 0x385f92ff, 0x4f7fc0ff];

/**
 * Each demo is one block: a caption, then a clipping viewport whose
 * `forwardFocus` enters the scroller, so keys still reach the items the
 * pointer moves. The captions themselves skip focus.
 */
export function TouchScrollScreen() {
  return (
    <Screen title="Touch scrolling">
      <view width={contentWidth()} height={CAPTION + CARD} forwardFocus={1}>
        <text skipFocus fontSize={18} color={MUTED}>
          Drag the rail sideways; release to fling and snap.
        </text>
        <view
          y={CAPTION}
          width={contentWidth()}
          height={CARD}
          clipping
          forwardFocus={0}
          ariaLabel="Horizontal rail"
        >
          <Row scroll="touch" gap={GAP}>
            <For each={numbers(12)}>
              {(i) => (
                <view
                  width={CARD}
                  height={CARD}
                  style={interactive}
                  color={SWATCHES[i % SWATCHES.length]!}
                  borderRadius={8}
                >
                  <text x={14} y={CARD / 2 - 12} fontSize={24} color={TEXT}>
                    {`${i + 1}`}
                  </text>
                </view>
              )}
            </For>
          </Row>
        </view>
      </view>

      <view width={contentWidth()} height={CAPTION + 250} forwardFocus={1}>
        <text skipFocus fontSize={18} color={MUTED}>
          A vertical page whose rail claims only horizontal drags.
        </text>
        <view
          y={CAPTION}
          width={contentWidth()}
          height={250}
          clipping
          forwardFocus={0}
          ariaLabel="Vertical page"
        >
          <Column scroll="touch" gap={8} width={contentWidth()}>
            <For each={numbers(4)}>
              {(i) => (
                <view
                  width={contentWidth()}
                  height={44}
                  style={interactive}
                  color={SWATCHES[(i + 1) % SWATCHES.length]!}
                  borderRadius={8}
                >
                  <text x={14} y={10} fontSize={22} color={TEXT}>
                    {`Page row ${i + 1}`}
                  </text>
                </view>
              )}
            </For>
            <view width={contentWidth()} height={100} clipping forwardFocus={0}>
              <Row scroll="touch" gap={8}>
                <For each={numbers(8)}>
                  {(i) => (
                    <view
                      width={160}
                      height={100}
                      style={interactive}
                      color={SWATCHES[(i + 2) % SWATCHES.length]!}
                      borderRadius={8}
                    >
                      <text x={12} y={36} fontSize={22} color={TEXT}>
                        {`Rail ${i + 1}`}
                      </text>
                    </view>
                  )}
                </For>
              </Row>
            </view>
            <For each={numbers(3)}>
              {(i) => (
                <view
                  width={contentWidth()}
                  height={44}
                  style={interactive}
                  color={SWATCHES[i % SWATCHES.length]!}
                  borderRadius={8}
                >
                  <text x={14} y={10} fontSize={22} color={TEXT}>
                    {`Page row ${i + 5}`}
                  </text>
                </view>
              )}
            </For>
          </Column>
        </view>
      </view>
    </Screen>
  );
}
