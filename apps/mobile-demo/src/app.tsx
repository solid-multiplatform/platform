/**
 * The mobile demo. Two modes on one scene: Discover (a TMDB-style media
 * browser) and Chat (ten thousand virtualised messages). Both stay mounted
 * offscreen when the other is active, so mode switching loses neither scroll
 * position nor loaded posters.
 */
import {
  createMemo,
  createSignal,
  defineTheme,
  Show,
  useViewport,
  type AppSettings,
} from '@solid-multiplatform/platform/app';
import { FPSCounter } from '@solid-multiplatform/platform/primitives';
import {
  getRenderer,
  registerDefaultShaders,
} from '@solid-multiplatform/platform';
import { apiDetail, apiEnabled, type Title } from './catalog';
import { Chat } from './screens/Chat';
import { Discover } from './screens/Discover';
import { Details } from './components/Details';
import { TopBar } from './components/TopBar';
import { createChatState, createDiscoverState } from './state';
import { C, metricsFor } from './theme';

export default function App() {
  // The web host registers the framework's default shaders; the NativeScript
  // host does not (hosts/web.ts:216 does it, the native host has no call), so
  // rounded corners, borders and gradients would be square. Register them
  // before any node is created.
  const renderer = getRenderer();
  if (renderer) {
    registerDefaultShaders(
      renderer as unknown as Parameters<typeof registerDefaultShaders>[0],
    );
  }
  const viewport = useViewport;
  const metrics = createMemo(() =>
    metricsFor(
      viewport().width,
      viewport().height,
      viewport().safeArea.top,
      viewport().safeArea.bottom,
      viewport().keyboardInset,
    ),
  );
  const discover = createDiscoverState(
    () => metrics().cardW,
    () => metrics().cardGap,
  );
  const chat = createChatState();
  const [mode, setMode] = createSignal<'discover' | 'chat'>('discover');
  const [meter, setMeter] = createSignal(false);
  const [detail, setDetail] = createSignal<Title | null>(null);
  const [saved, setSaved] = createSignal<ReadonlySet<number>>(new Set());

  const open = (title: Title) => {
    setDetail(title);
    // A rail from TMDB carries no cast; the detail request fills it in when a
    // key is configured. A failure leaves the list result on screen.
    if (apiEnabled() && !(title.cast && title.cast.length > 0)) {
      void apiDetail(title)
        .then((full) => {
          if (detail()?.id === title.id) setDetail(full);
        })
        .catch(() => undefined);
    }
  };
  const toggleSaved = (title: Title) => {
    const next = new Set(saved());
    if (next.has(title.id)) next.delete(title.id);
    else next.add(title.id);
    setSaved(next);
  };
  const back = () => {
    if (detail()) {
      setDetail(null);
      return true;
    }
    if (mode() === 'chat') {
      setMode('discover');
      return true;
    }
    return false;
  };

  const m = () => metrics();
  const inactiveX = () => m().width * 2;

  return (
    <view
      width={m().width}
      height={m().height}
      color={C.background}
      clipping
      autofocus
      onBack={back}
      onEscape={back}
    >
      <view
        x={mode() === 'discover' ? 0 : inactiveX()}
        y={0}
        width={m().width}
        height={m().height}
      >
        <Discover
          state={discover}
          metrics={m()}
          saved={saved()}
          onOpen={open}
          onToggleSaved={toggleSaved}
        />
        <Show when={detail()} keyed>
          {(title) => (
            <Details
              title={title}
              metrics={m()}
              onClose={() => setDetail(null)}
              onOpen={open}
            />
          )}
        </Show>
      </view>

      <view
        x={mode() === 'chat' ? 0 : inactiveX()}
        y={0}
        width={m().width}
        height={m().height}
      >
        <Chat chat={chat} metrics={m()} />
      </view>

      <Show when={!detail()}>
        <TopBar
          metrics={m()}
          mode={mode()}
          meter={meter()}
          onMode={setMode}
          onMeter={() => setMeter((open) => !open)}
        />
      </Show>

      <Show when={meter()}>
        <view
          x={0}
          y={m().barY + m().barH + 8}
          width={m().width}
          height={120}
          zIndex={70}
        >
          <FPSCounter />
        </view>
      </Show>
    </view>
  );
}

const demoTheme = defineTheme({
  colors: {
    background: C.background,
    surface: C.surface,
    surfaceRaised: C.surfaceHigh,
    text: C.text,
    textMuted: C.muted,
    primary: C.accent,
    onPrimary: C.onAccent,
    border: C.line,
    focus: C.accent,
    selection: C.accentSoft,
  },
  typography: { body: 15, label: 12, title: 34, headline: 40 },
  radius: { small: 8, medium: 12, large: 18 },
});

export const options: AppSettings = {
  theme: demoTheme,
};
