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
  const bounds = (offset: number) => {
    const v = p.viewport();
    // Keep native controls above the software keyboard and inside the safe
    // area. The host reports both; the screen does not need platform checks.
    const height = 50;
    return {
      x: v.safeArea.left + 16,
      y: Math.min(
        v.safeArea.top + 16 + offset,
        v.height - v.keyboardInset - height - 12,
      ),
      width: Math.max(
        0,
        v.width - v.safeArea.left - v.safeArea.right - 32,
      ),
      height,
    };
  };
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
