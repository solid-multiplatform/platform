/**
 * Sona: a small music library used to show every primitive in a real flow.
 * One source, three shells. The UI family — phone, TV, desktop — decides the
 * navigation, the sizes and the interaction; the screens themselves are the
 * same.
 */
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  Show,
  type JSX,
} from 'solid-js';
import {
  defineTheme,
  ThemeProvider,
  useViewport,
} from '@solid-multiplatform/platform/app';
import type { BackDispatcher } from '@solid-multiplatform/platform';
import { Glyph, type GlyphName } from './components/Glyph';
import { C, R, S, T } from './theme';
import { uiFamily } from './family';
import { Library } from './screens/Library';
import { AlbumScreen } from './screens/Album';
import type { Album } from './data';
import { Create } from './screens/Create';
import { Performance } from './screens/Performance';
import { Settings as SettingsScreen } from './screens/Settings';

export const galleryTheme = defineTheme({
  colors: {
    background: C.background,
    surface: C.surface,
    surfaceRaised: C.raised,
    text: C.text,
    textMuted: C.muted,
    primary: C.accent,
    onPrimary: C.onAccent,
    border: C.line,
    focus: C.accent,
    selection: C.accentSoft,
    success: C.muted,
    warning: C.dim,
    danger: C.accent,
  },
  typography: {
    body: T.body,
    label: T.label,
    title: T.title,
    headline: T.headline,
  },
  radius: { small: R.small, medium: R.medium, large: R.large },
});

export type Route = 'library' | 'create' | 'performance' | 'settings' | 'album';

const NAV: { route: Route; label: string; glyph: GlyphName }[] = [
  { route: 'library', label: 'Library', glyph: 'library' },
  { route: 'create', label: 'Create', glyph: 'plus' },
  { route: 'performance', label: 'Performance', glyph: 'activity' },
  { route: 'settings', label: 'Settings', glyph: 'filter' },
];

export function App(props: { back?: BackDispatcher }): JSX.Element {
  const viewport = useViewport;
  const family = () => uiFamily();
  const [route, setRoute] = createSignal<Route>('library');
  const [album, setAlbum] = createSignal<Album>();
  const openAlbum = (next: Album) => {
    setAlbum(next);
    setRoute('album');
  };
  // Back leaves a detail screen first; on the shell's root the host owns it.
  createEffect(() => {
    if (route() === 'library' || props.back === undefined) return;
    onCleanup(
      props.back.push(() => {
        setRoute('library');
        setAlbum(undefined);
        return true;
      }),
    );
  });

  // The sidebar is a phone's tab bar, a TV's focus rail, or a desktop's
  // sidebar — the same three destinations, sized for the room.
  const sidebar = () => (family() === 'tv' ? 300 : 248);
  const hasSidebar = () => family() !== 'mobile';
  const contentX = () => (hasSidebar() ? sidebar() : 0);
  const tabHeight = () => 76 + viewport().safeArea.bottom;

  const navRow = (item: (typeof NAV)[number], side: boolean) => {
    const active = () => route() === item.route;
    const tv = () => family() === 'tv';
    const height = side ? (tv() ? 64 : 44) : 56;
    return (
      <view
        width={side ? sidebar() - S(4) : viewport().width / NAV.length}
        height={height}
        borderRadius={side ? R.small : R.medium}
        color={active() && side ? C.raised : 0x00000000}
        display="flex"
        flexDirection={side ? 'row' : 'column'}
        alignItems="center"
        gap={side ? S(3) : S(1)}
        onEnter={() => {
          setRoute(item.route);
        }}
        onMouseClick={() => {
          setRoute(item.route);
        }}
        cursorStyle="pointer"
        style={{ $focus: { color: C.accentSoft } }}
      >
        <Glyph
          name={item.glyph}
          size={side ? (tv() ? 26 : 18) : 21}
          color={active() ? C.accent : C.muted}
        />
        <text
          fontSize={side ? (tv() ? 22 : T.label) : 10}
          color={active() ? C.text : C.muted}
          letterSpacing={side ? 0 : 0.3}
        >
          {item.label}
        </text>
      </view>
    );
  };

  return (
    <ThemeProvider theme={galleryTheme}>
      <view
        width={viewport().width}
        height={viewport().height}
        color={C.background}
      >
        <Show when={hasSidebar()}>
          <view
            x={0}
            y={0}
            width={sidebar()}
            height={viewport().height}
            color={C.surface}
          >
            <text
              x={S(6)}
              y={S(10)}
              fontSize={family() === 'tv' ? T.title : T.headline}
              color={C.text}
            >
              Sona
            </text>
            <text
              x={S(6)}
              y={S(10) + (family() === 'tv' ? 34 : 24)}
              fontSize={family() === 'tv' ? T.body : T.caption}
              color={C.dim}
            >
              a design gallery
            </text>
            <view
              x={S(2)}
              y={S(22)}
              display="flex"
              flexDirection="column"
              gap={S(1)}
            >
              <For each={NAV}>{(item) => navRow(item, true)}</For>
            </view>
            <text
              x={S(6)}
              y={viewport().height - S(8)}
              fontSize={family() === 'tv' ? T.body : T.caption}
              color={C.dim}
            >
              One accent · three shells
            </text>
          </view>
        </Show>

        <view
          x={contentX()}
          y={0}
          width={viewport().width - contentX()}
          height={viewport().height - (family() === 'mobile' ? tabHeight() : 0)}
          display="flex"
          flexDirection="column"
        >
          <Show when={route() === 'library'}>
            <Library
              family={family()}
              width={viewport().width - contentX()}
              height={
                viewport().height - (family() === 'mobile' ? tabHeight() : 0)
              }
              onOpenCreate={() => setRoute('create')}
              onOpenAlbum={openAlbum}
            />
          </Show>
          <Show when={route() === 'create'}>
            <Create
              family={family()}
              width={viewport().width - contentX()}
              height={
                viewport().height - (family() === 'mobile' ? tabHeight() : 0)
              }
              onDone={() => setRoute('library')}
            />
          </Show>
          <Show when={route() === 'album' && album() !== undefined}>
            <AlbumScreen
              album={album()!}
              family={family()}
              x={contentX()}
              width={viewport().width - contentX()}
              height={
                viewport().height - (family() === 'mobile' ? tabHeight() : 0)
              }
              onBack={() => {
                setRoute('library');
                setAlbum(undefined);
              }}
            />
          </Show>
          <Show when={route() === 'settings'}>
            <SettingsScreen
              family={family()}
              x={contentX()}
              width={viewport().width - contentX()}
              height={
                viewport().height - (family() === 'mobile' ? tabHeight() : 0)
              }
            />
          </Show>
          <Show when={route() === 'performance'}>
            <Performance
              family={family()}
              width={viewport().width - contentX()}
              height={
                viewport().height - (family() === 'mobile' ? tabHeight() : 0)
              }
            />
          </Show>
        </view>

        <Show when={family() === 'mobile'}>
          <view
            x={0}
            y={viewport().height - tabHeight()}
            width={viewport().width}
            height={tabHeight()}
            color={C.surface}
          >
            <view
              x={0}
              y={0}
              width={viewport().width}
              height={1}
              color={C.lineSoft}
            />
            <view
              x={0}
              y={6}
              width={viewport().width}
              display="flex"
              flexDirection="row"
              alignItems="center"
            >
              <For each={NAV}>{(item) => navRow(item, false)}</For>
            </view>
          </view>
        </Show>
      </view>
    </ThemeProvider>
  );
}
