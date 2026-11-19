/**
 * The showcase: every UI primitive and every device service of the framework
 * on one scene, and the probe that says what works on a target.
 *
 * Routing is the SDK's host-neutral stack (`createNavigation`): the hash
 * router in `primitives/router` reads `window.location`, which only a browser
 * has. Back and Escape pop the stack from anywhere; at home they are left to
 * the host.
 *
 * Idle rule: no screen owns a timer, an animation or a subscription that runs
 * while nothing is pressed.
 */
import { createMemo, createSignal, onMount, Show } from 'solid-js';
import { darkTheme, ThemeProvider } from '@solid-multiplatform/platform';
import { createNavigation } from '@solid-multiplatform/platform/navigation';
import { focusVisible } from '@solid-multiplatform/platform/focusManager';
import { FPSCounter } from '@solid-multiplatform/platform/primitives';
import { viewport } from '@solid-multiplatform/platform/viewport';
import { ShowcaseContext, type Showcase, type ShowcaseEnv } from './env';
import { attachFrameCounter } from './frames';
import { runProbeMode } from './probe/run';
import { sections } from './routes';
import { HomeScreen } from './screens/Home';
import { BACKGROUND } from './ui';

export function App(props: { env: ShowcaseEnv }) {
  const nav = createNavigation({ path: '/' });
  const showcase: Showcase = {
    env: props.env,
    nav,
    go: (path) => void nav.push({ path }),
    back: () => nav.back(),
  };
  attachFrameCounter();
  // The performance meter is off by default: while it is closed it has no
  // listener and no timer (see `primitives/FPSCounter`).
  const [meter, setMeter] = createSignal(false);
  const path = createMemo(() => nav.route().path);
  const screen = createMemo(
    () => sections.find((section) => section.path === path())?.screen,
  );
  onMount(() => {
    if (props.env.launch.probe) void runProbeMode(showcase);
  });
  // The scene is dark whatever the system prefers, so the themed controls
  // (Checkbox, Radio, Select) get the dark tokens rather than the system's.
  return (
    <ShowcaseContext.Provider value={showcase}>
      <ThemeProvider theme={darkTheme}>
        <view
          width={viewport().width}
          height={viewport().height}
          color={BACKGROUND}
          onBack={() => showcase.back()}
          onEscape={() => showcase.back()}
          onKeyPress={(event: KeyboardEvent) => {
            // F is not in the key map: every node sees the key, and the
            // first handler to return true consumes it.
            if (event.key !== 'f' && event.key !== 'F') return;
            setMeter((open) => !open);
            return true;
          }}
        >
          <Show when={screen()} keyed fallback={<HomeScreen />}>
            {(Current) => <Current />}
          </Show>
          {/* The focus-visibility modality, for the browser walk: out of
              sight but in the accessibility mirror, where the e2e reads it. */}
          <text
            skipFocus
            alpha={0}
            role="status"
            ariaLabel={`Focus ring: ${focusVisible() ? 'visible' : 'hidden'}`}
            x={0}
            y={viewport().height - 20}
            fontSize={14}
            color={BACKGROUND}
          >
            {`Focus ring: ${focusVisible() ? 'visible' : 'hidden'}`}
          </text>
          <Show when={meter()}>
            <FPSCounter />
          </Show>
        </view>
      </ThemeProvider>
    </ShowcaseContext.Provider>
  );
}
