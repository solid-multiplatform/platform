/**
 * One row per service in the registry, generated from `serviceTable`. A row
 * without a provider reads `unavailable`; Enter (or a click) runs the others,
 * attended, and the row shows what came back.
 */
import { createSignal, For } from 'solid-js';
import { Column } from '@solid-multiplatform/platform/primitives';
import {
  serviceAvailable,
  type ServiceName,
} from '@solid-multiplatform/platform/services';
import { describe } from '../probe/result';
import { results, runAllUnattended, runRow } from '../services/run';
import { serviceNames, serviceTable } from '../services/table';
import { Button, contentWidth, interactive, MUTED, Screen, TEXT } from '../ui';

const ROW = 44;
const GAP = 6;
const VISIBLE = 7;

function status(name: ServiceName): string {
  const outcome = results()[name];
  if (outcome) return describe(outcome);
  return serviceAvailable(name) === 'unavailable'
    ? 'unavailable'
    : 'Enter to run';
}

export function ServicesScreen() {
  const [selected, setSelected] = createSignal<ServiceName>(serviceNames[0]!);
  return (
    <Screen title={`Services (${serviceNames.length})`}>
      <Button
        label="Run every unattended probe"
        width={360}
        onEnter={() => void runAllUnattended()}
      />
      <view
        width={contentWidth()}
        height={VISIBLE * (ROW + GAP)}
        clipping
        forwardFocus={0}
      >
        <Column
          gap={GAP}
          onSelectedChanged={(index) => setSelected(serviceNames[index]!)}
        >
          <For each={serviceNames}>
            {(name) => (
              <view
                width={contentWidth()}
                height={ROW}
                style={interactive}
                ariaLabel={`${name}: ${status(name)}`}
                onEnter={() => void runRow(name, true)}
              >
                <text x={16} y={9} fontSize={20} color={TEXT}>
                  {name}
                </text>
                <text
                  x={240}
                  y={9}
                  width={contentWidth() - 260}
                  contain="width"
                  maxLines={1}
                  fontSize={20}
                  color={MUTED}
                >
                  {status(name)}
                </text>
              </view>
            )}
          </For>
        </Column>
      </view>
      <text
        skipFocus
        width={contentWidth()}
        contain="width"
        fontSize={18}
        color={MUTED}
      >
        {`${selected()} calls ${serviceTable[selected()].call}. Judged by: ${serviceTable[selected()].judge}.`}
      </text>
    </Screen>
  );
}
