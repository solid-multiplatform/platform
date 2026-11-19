/**
 * What the app is running on, and the idle rule made visible: the number of
 * frames the renderer drew in the last two seconds. The number is read when
 * the button is activated, in that key's own handler, so reading it costs no
 * timer and no frame; left alone for two seconds, it reads 0.
 */
import { createSignal, For } from 'solid-js';
import { useCapabilities } from '@solid-multiplatform/platform';
import { installedServices } from '@solid-multiplatform/platform/services';
import { viewport } from '@solid-multiplatform/platform/viewport';
import { useShowcase } from '../env';
import { frameCounterAttached, framesInLast, totalFrames } from '../frames';
import { layoutFor } from '../layout';
import { Button, contentWidth, MUTED, Screen, TEXT } from '../ui';

export function DiagnosticsScreen() {
  const { env } = useShowcase();
  const [frames, setFrames] = createSignal('not measured yet');
  const measure = () =>
    setFrames(
      frameCounterAttached()
        ? `${framesInLast(2000)} in the last 2 s, ${totalFrames()} since start`
        : 'unverified: this backend reports no frame event',
    );
  const lines = () => {
    const v = viewport();
    const services = installedServices();
    return [
      `Target: ${env.target}`,
      `Renderer backend: ${env.backend}`,
      `Viewport: ${v.width} x ${v.height}, scale ${v.scale}, framebuffer ${v.framebufferWidth} x ${v.framebufferHeight}`,
      `Layout: ${layoutFor(v.width)} (mobile at most 500 wide, tv above 1600)`,
      `Capabilities: ${JSON.stringify(useCapabilities())}`,
      `Installed services (${services.length}): ${services.join(', ')}`,
    ];
  };
  return (
    <Screen title="Diagnostics">
      <Button label="Measure frames" width={280} onEnter={measure} />
      <text skipFocus fontSize={22} color={TEXT}>
        {`Frames: ${frames()}`}
      </text>
      <For each={lines()}>
        {(line) => (
          <text
            skipFocus
            width={contentWidth()}
            contain="width"
            fontSize={18}
            color={MUTED}
          >
            {line}
          </text>
        )}
      </For>
    </Screen>
  );
}
