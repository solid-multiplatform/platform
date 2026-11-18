import { For } from '@solid-multiplatform/platform';
import {
  Button,
  Controls,
  Label,
} from '@solid-multiplatform/platform/controls';
import { nativeControls } from '@solid-multiplatform/platform/controls/native';
import type { ScreenProps } from '../screen';
export function Home(p: ScreenProps) {
  if (!p.host?.root)
    throw new Error('The mobile screen requires its native host');
  const surface = nativeControls(p.host.root, p.host.target);
  const bounds = (offset: number) => ({
    x: p.viewport().safeArea.left + 16,
    y: p.viewport().safeArea.top + 16 + offset,
    width: Math.max(
      0,
      p.viewport().width -
        p.viewport().safeArea.left -
        p.viewport().safeArea.right -
        32,
    ),
    height: 50,
  });
  return (
    <Controls surface={surface}>
      <Label bounds={bounds(0)} label={p.message()} />
      <For each={p.names}>
        {(name, i) => (
          <Button
            bounds={bounds(64 + i() * 58)}
            label={name}
            onActivate={() => p.activate(name)}
          />
        )}
      </For>
    </Controls>
  );
}
