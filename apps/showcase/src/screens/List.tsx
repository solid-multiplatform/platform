/** A virtual list: 1,000 rows, a window of them mounted. */
import { createSignal, onCleanup } from 'solid-js';
import type { ElementNode } from '@solid-multiplatform/platform';
import { VirtualColumn } from '@solid-multiplatform/platform/primitives';
import { probeHooks } from '../probe/hooks';
import { interactive, MUTED, Screen, TEXT } from '../ui';

export const LIST_SIZE = 1000;
const items = Array.from({ length: LIST_SIZE }, (_, i) => i);
const VISIBLE = 8;
const ROW = 48;
const GAP = 6;

export function ListScreen() {
  const [index, setIndex] = createSignal(0);
  probeHooks.listIndex = index;
  onCleanup(() => {
    probeHooks.list = undefined;
    probeHooks.listIndex = undefined;
  });
  return (
    <Screen title="Virtual list">
      <text skipFocus fontSize={20} color={MUTED}>
        {`Row ${index() + 1} of ${LIST_SIZE}. Up and Down scroll; only a window of rows exists.`}
      </text>
      <view
        width={560}
        height={VISIBLE * (ROW + GAP)}
        clipping
        forwardFocus={0}
      >
        <VirtualColumn
          ref={(node: ElementNode) => {
            probeHooks.list = node;
          }}
          each={items}
          displaySize={VISIBLE}
          gap={GAP}
          onSelectedChanged={(_selected, _list, child) => {
            const item = (child as { item?: number } | undefined)?.item;
            if (item !== undefined) setIndex(item);
          }}
        >
          {(item) => (
            <view
              item={item()}
              width={560}
              height={ROW}
              style={interactive}
              onEnter={() => {
                setIndex(item());
              }}
            >
              <text x={16} y={10} fontSize={22} color={TEXT}>
                {`Item ${item() + 1}`}
              </text>
            </view>
          )}
        </VirtualColumn>
      </view>
    </Screen>
  );
}
