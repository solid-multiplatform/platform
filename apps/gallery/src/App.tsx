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
  useContext,
  type JSX,
} from 'solid-js';
import {
  defineTheme,
  ThemeProvider,
  useViewport,
} from '@solid-multiplatform/platform/app';
import { HostScope } from '@solid-multiplatform/platform/app';
import { Column, Row } from '@solid-multiplatform/platform/primitives';
import { Glyph, type GlyphName } from './components/Glyph';
import { C, R, S, T } from './theme';
import { uiFamily } from './family';
import { pageLayout } from './layout';
import { HeroFlight, type HeroRect } from './motion/hero';
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

export function App(): JSX.Element {
  const viewport = useViewport;
  // The host's one Back dispatcher, carried by the scope: the app needs no
  // props, so the same component is the CLI's `app.tsx` on native targets.
  const back = useContext(HostScope)?.back;
  const family = () => uiFamily();
  const [route, setRoute] = createSignal<Route>('library');
  const [album, setAlbum] = createSignal<Album>();

  // The matched-geometry flight: the pressed card's cover grows into the
  // album's cover (and back). `from` is the card's box when it was pressed;
  // `to` arrives one frame after the album lays out. The two covers are
  // hidden for the duration so only the clone is visible.
  const [flight, setFlight] = createSignal<{
    album: Album;
    from: HeroRect;
    to?: HeroRect;
    back: boolean;
  }>();
  // The two boxes the flight interpolates between, kept after it lands so
  // the trip back can start from the album and end on the card.
  const [cardRect, setCardRect] = createSignal<HeroRect>();
  const [coverRect, setCoverRect] = createSignal<HeroRect>();
  const openAlbum = (next: Album, from?: HeroRect) => {
    setAlbum(next);
    setRoute('album');
    setCoverRect(undefined);
    setCardRect(from);
    setFlight(
      from === undefined ? undefined : { album: next, from, back: false },
    );
  };
  const landCover = (rect: HeroRect) => {
    setCoverRect(rect);
    setFlight((value) =>
      value === undefined ? value : { ...value, to: rect },
    );
  };
  const leaveAlbum = () => {
    const current = album();
    const from = coverRect();
    const card = cardRect();
    setRoute('library');
    setAlbum(undefined);
    setFlight(
      current !== undefined && from !== undefined && card !== undefined
        ? { album: current, from, to: card, back: true }
        : undefined,
    );
  };
  const flying = () => {
    const value = flight();
    return value?.to === undefined
      ? undefined
      : (value as typeof value & { to: HeroRect });
  };
  // Back leaves a detail screen first; on the shell's root the host owns it.
  createEffect(() => {
    if (route() === 'library' || back === undefined) return;
    onCleanup(
      back.push(() => {
        leaveAlbum();
        return true;
      }),
    );
  });

  // The sidebar is a phone's tab bar, a TV's focus rail, or a desktop's
  // sidebar — the same three destinations, sized for the room.
  const sidebar = () => 248;
  const hasSidebar = () => family() === 'desktop';
  const tv = () => family() === 'tv';
  const contentX = () => (hasSidebar() ? sidebar() : 0);
  const tabHeight = () => 76 + viewport().safeArea.bottom;
  const playerBottom = () => (family() === 'mobile' ? tabHeight() : 0);
  const bottomReserved = () => playerBottom() + (family() === 'tv' ? 0 : 62);

  const navRow = (item: (typeof NAV)[number], side: boolean) => {
    const active = () => route() === item.route;
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
        role="button"
        ariaLabel={item.label}
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

  const page = () => pageLayout(viewport().width - contentX(), family());
  const topNav = () => (
    <Row gap={S(2)} scroll="none" width={page().width}>
      <For each={NAV}>
        {(item) => (
          <view
            width={220}
            height={72}
            borderRadius={R.medium}
            color={route() === item.route ? C.raised : 0x00000000}
            display="flex"
            flexDirection="row"
            alignItems="center"
            gap={S(3)}
            role="button"
            ariaLabel={item.label}
            autofocus={item.route === 'library' && tv()}
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
              size={24}
              color={route() === item.route ? C.accent : C.muted}
            />
            <text
              fontSize={22}
              color={route() === item.route ? C.text : C.muted}
            >
              {item.label}
            </text>
          </view>
        )}
      </For>
    </Row>
  );

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
              y={S(6)}
              fontSize={family() === 'tv' ? T.title : T.headline}
              color={C.text}
            >
              Sona
            </text>
            <text
              x={S(6)}
              y={S(6) + (family() === 'tv' ? 34 : 24)}
              fontSize={family() === 'tv' ? T.body : T.caption}
              color={C.dim}
            >
              a design gallery
            </text>
            <Column
              x={S(2)}
              y={S(6) + 82}
              width={sidebar() - S(4)}
              scroll="none"
              gap={S(1)}
            >
              <For each={NAV}>{(item) => navRow(item, true)}</For>
            </Column>
            <text
              x={S(6)}
              y={viewport().height - S(8)}
              fontSize={family() === 'tv' ? T.body : T.caption}
              color={C.dim}
            >
              One accent, three shells
            </text>
          </view>
        </Show>

        <view
          x={contentX()}
          y={0}
          width={viewport().width - contentX()}
          height={viewport().height - bottomReserved()}
          display="flex"
          flexDirection="column"
        >
          <Show when={route() === 'library'}>
            <Library
              family={family()}
              width={viewport().width - contentX()}
              height={viewport().height - bottomReserved()}
              onOpenCreate={() => setRoute('create')}
              onOpenAlbum={openAlbum}
              hiddenAlbum={
                flight()?.back === true ? flight()?.album.id : undefined
              }
              topNav={tv() ? topNav() : undefined}
            />
          </Show>
          <Show when={route() === 'create'}>
            <Create
              family={family()}
              width={viewport().width - contentX()}
              height={viewport().height - bottomReserved()}
              onDone={() => setRoute('library')}
            />
          </Show>
          <Show when={route() === 'album' && album() !== undefined}>
            <AlbumScreen
              album={album()!}
              family={family()}
              x={contentX()}
              width={viewport().width - contentX()}
              height={viewport().height - bottomReserved()}
              hideCover={flight() !== undefined && flight()?.back === false}
              onCoverRect={landCover}
              onBack={leaveAlbum}
            />
          </Show>
          <Show when={route() === 'settings'}>
            <SettingsScreen
              family={family()}
              topNav={tv() ? topNav() : undefined}
              x={contentX()}
              width={viewport().width - contentX()}
              height={viewport().height - bottomReserved()}
            />
          </Show>
          <Show when={route() === 'performance'}>
            <Performance
              family={family()}
              topNav={tv() ? topNav() : undefined}
              width={viewport().width - contentX()}
              height={viewport().height - bottomReserved()}
            />
          </Show>
        </view>

        <Show when={family() !== 'tv'}>
          {/* The player stays with the shell: the same track whatever screen. */}
          <view
            x={contentX()}
            y={viewport().height - playerBottom() - 62}
            width={viewport().width - contentX()}
            height={62}
            color={C.surface}
          >
            <view
              x={0}
              y={0}
              width={viewport().width - contentX()}
              height={1}
              color={C.lineSoft}
            />
            <view
              x={page().x}
              y={11}
              width={40}
              height={40}
              borderRadius={R.small}
              clipping
            >
              <view
                width={40}
                height={40}
                linearGradient={{
                  colors: [0x2b3a67ff, 0x0d1220ff],
                  angle: 135,
                  stops: [0, 1],
                }}
              />
            </view>
            <text x={page().x + 52} y={13} fontSize={T.caption} color={C.text}>
              Carriage Return
            </text>
            <text x={page().x + 52} y={31} fontSize={10} color={C.muted}>
              Mira Vale
            </text>
            <view
              x={page().x + page().width - 52}
              y={14}
              width={34}
              height={34}
              borderRadius={17}
              border={{ width: 1, color: C.line }}
              display="flex"
              alignItems="center"
              justifyContent="center"
              onEnter={() => undefined}
              onMouseClick={() => undefined}
              cursorStyle="pointer"
            >
              <Glyph name="play" size={12} color={C.text} />
            </view>
            <view
              x={page().x}
              y={56}
              width={page().width}
              height={2}
              borderRadius={1}
              color={C.lineSoft}
            />
            <view
              x={page().x}
              y={56}
              width={page().width * 0.32}
              height={2}
              borderRadius={1}
              color={C.accent}
            />
          </view>
        </Show>

        <Show when={flying()}>
          {(value) => (
            <HeroFlight
              album={value().album}
              from={value().from}
              to={value().to}
              onDone={() => setFlight(undefined)}
            />
          )}
        </Show>

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
