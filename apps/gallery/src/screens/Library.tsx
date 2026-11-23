import { For, Show, type JSX } from 'solid-js';
import type { ElementNode } from '@solid-multiplatform/platform';
import { Column, Row } from '@solid-multiplatform/platform/primitives';
import { Cover } from '../components/Cover';
import { Glyph, type GlyphName } from '../components/Glyph';
import { ALBUMS, RAILS, albumSeconds, type Album } from '../data';
import type { UiFamily } from '../family';
import { C, formatTotal, R, S, T } from '../theme';
import { pageLayout } from '../layout';
import { lineOf, rectOf, type HeroCardSpot } from '../motion/hero';
import { PulseDot } from '../motion/pulse-dot';

/** A primary action: the accent gradient, used once per screen. */
export function GradientButton(props: {
  label: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  autofocus?: boolean;
  onPress?(): void;
}): JSX.Element {
  return (
    <view
      x={props.x}
      y={props.y}
      width={props.width ?? 128}
      height={props.height ?? 44}
      borderRadius={R.pill}
      display="flex"
      alignItems="center"
      justifyContent="center"
      linearGradient={{
        colors: [C.accent, 0xb8442aff],
        angle: 120,
        stops: [0, 1],
      }}
      onEnter={() => props.onPress?.()}
      onMouseClick={() => props.onPress?.()}
      cursorStyle="pointer"
      style={{
        $focus: { color: C.onAccent },
        $pressed: { color: 0x8f3320ff },
      }}
    >
      <text fontSize={T.label} color={C.onAccent}>
        {props.label}
      </text>
    </view>
  );
}

/** A quiet action: outline, no fill. */
export function GhostButton(props: {
  label: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  autofocus?: boolean;
  onPress?(): void;
}): JSX.Element {
  return (
    <view
      x={props.x}
      y={props.y}
      width={props.width ?? 112}
      height={props.height ?? 44}
      borderRadius={R.pill}
      border={{ width: 1, color: C.line }}
      display="flex"
      alignItems="center"
      justifyContent="center"
      autofocus={props.autofocus}
      onEnter={() => props.onPress?.()}
      onMouseClick={() => props.onPress?.()}
      cursorStyle="pointer"
      style={{
        $focus: { border: { width: 1, color: C.accent } },
        $pressed: { color: C.raised },
      }}
    >
      <text fontSize={T.label} color={C.text}>
        {props.label}
      </text>
    </view>
  );
}

/** A round icon action. */
export function IconButton(props: {
  glyph: GlyphName;
  x?: number;
  y?: number;
  size?: number;
  label: string;
  onPress?(): void;
}): JSX.Element {
  const size = () => props.size ?? 44;
  return (
    <view
      x={props.x}
      y={props.y}
      width={size()}
      height={size()}
      borderRadius={size() / 2}
      border={{ width: 1, color: C.line }}
      display="flex"
      alignItems="center"
      justifyContent="center"
      role="button"
      ariaLabel={props.label}
      onEnter={() => props.onPress?.()}
      onMouseClick={() => props.onPress?.()}
      cursorStyle="pointer"
      style={{
        $focus: { border: { width: 1, color: C.accent } },
        $pressed: { color: C.raised },
      }}
    >
      <Glyph name={props.glyph} size={size() * 0.44} color={C.text} />
    </view>
  );
}

function AlbumCard(props: {
  album: Album;
  size: number;
  width: number;
  family: UiFamily;
  /**
   * The card a hero flight is about, by identity: only the pressed instance
   * hides its cover. The same album appears in several rails, and hiding by
   * album id left blank holes everywhere else the album is shown.
   */
  hiddenCard?: ElementNode;
  onOpen?: (album: Album, spot?: HeroCardSpot) => void;
}): JSX.Element {
  let cover: ElementNode | undefined;
  let cardRoot: ElementNode | undefined;
  let titleNode: ElementNode | undefined;
  const open = () =>
    props.onOpen?.(props.album, {
      node: cardRoot,
      cover: rectOf(cover),
      coverNode: cover,
      title:
        lineOf(titleNode) === undefined
          ? undefined
          : {
              ...lineOf(titleNode)!,
              fontSize: props.family === 'tv' ? T.body : T.label,
            },
      titleNode: titleNode,
    });
  return (
    <view
      ref={(node) => (cardRoot = node)}
      width={props.width}
      display="flex"
      flexDirection="column"
      gap={S(2)}
      onEnter={open}
      onMouseClick={open}
      cursorStyle="pointer"
      style={{ $focus: { color: 0x00000000 } }}
    >
      <Cover
        ref={(node) => (cover = node)}
        album={props.album}
        size={props.size}
        radius={R.medium}
        hidden={props.hiddenCard !== undefined && props.hiddenCard === cardRoot}
      />
      <view display="flex" flexDirection="column" gap={2}>
        <text
          ref={(node) => (titleNode = node)}
          width={props.width}
          contain="width"
          maxLines={1}
          fontSize={props.family === 'tv' ? T.body : T.label}
          color={C.text}
        >
          {props.album.title}
        </text>
        <text
          width={props.width}
          contain="width"
          maxLines={1}
          fontSize={props.family === 'tv' ? T.label : T.caption}
          color={C.muted}
        >
          {props.album.artist}
        </text>
      </view>
    </view>
  );
}

function Rail(props: {
  title: string;
  albums: Album[];
  family: UiFamily;
  /** The shelf's clip: from the page's left edge to the window's right. */
  width: number;
  cardSize: number;
  hiddenCard?: ElementNode;
  onOpenAlbum?: (album: Album, spot?: HeroCardSpot) => void;
}): JSX.Element {
  return (
    <view
      display="flex"
      flexDirection="column"
      gap={S(3)}
      width={props.width}
      height={props.cardSize + 52 + (props.family === 'tv' ? 44 : 26)}
    >
      <text
        fontSize={props.family === 'tv' ? T.headline : T.label}
        color={props.family === 'tv' ? C.text : C.muted}
        letterSpacing={props.family === 'tv' ? 0 : 0.6}
      >
        {props.title}
      </text>
      <view width={props.width} clipping>
        <Row
          width={props.width}
          gap={S(4)}
          scroll={props.family === 'mobile' ? 'touch' : 'auto'}
          style={{ padding: 0 }}
        >
          <For each={props.albums}>
            {(album) => (
              <AlbumCard
                album={album}
                size={props.cardSize}
                width={props.cardSize}
                family={props.family}
                hiddenCard={props.hiddenCard}
                onOpen={props.onOpenAlbum}
              />
            )}
          </For>
        </Row>
      </view>
    </view>
  );
}

export function Library(props: {
  family: UiFamily;
  width: number;
  height: number;
  onOpenCreate?(): void;
  topNav?: JSX.Element;
  /** The card a hero flight is drawing instead of (by identity, not id). */
  hiddenCard?: ElementNode;
  onOpenAlbum?(album: Album, spot?: HeroCardSpot): void;
}): JSX.Element {
  const tv = () => props.family === 'tv';
  const mobile = () => props.family === 'mobile';
  const width = () => props.width;
  const page = () => pageLayout(width(), props.family);
  const featured = () => ALBUMS[0]!;
  const cover = () => (tv() ? 320 : mobile() ? 132 : 208);
  const card = () => (tv() ? 220 : mobile() ? 138 : 168);
  // A rail starts on the page's left edge and runs to the window's edge: the
  // shelf's peek is then cut by the screen, as a shelf's is, not 32 units
  // inside it by the page's margin.
  const railWidth = () => width() - page().x;

  return (
    <view width={width()} height={props.height} clipping>
      {/* The Column's direct children are the page's sections: on a TV the
          arrows move between rows and the page scrolls to the focused one;
          on a phone the same Column is the touch scroller. */}
      <Column
        x={page().x}
        y={S(6)}
        width={page().width}
        height={props.height - S(6)}
        gap={tv() ? S(10) : S(6)}
        scroll={tv() ? 'edge' : 'touch'}
        selected={0}
      >
        {props.topNav}
        {/* Header */}
        <view
          width={page().width}
          height={tv() ? 120 : 58}
          display="flex"
          flexDirection="row"
          alignItems="center"
          justifyContent="spaceBetween"
        >
          <view display="flex" flexDirection="column" gap={S(1)}>
            <text fontSize={tv() ? T.display : T.title} color={C.text}>
              Library
            </text>
            <text fontSize={tv() ? T.body : T.caption} color={C.muted}>
              {`${ALBUMS.length} albums, ${RAILS.length} rails, one accent`}
            </text>
          </view>
          <Show when={!mobile()}>
            <Row gap={S(3)} scroll="none">
              <GhostButton label="New playlist" onPress={props.onOpenCreate} />
              <IconButton glyph="search" label="Search" />
              <IconButton glyph="filter" label="Filter" />
            </Row>
          </Show>
        </view>

        {/* Hero: the featured album, with the screen's one gradient CTA. */}
        <view
          width={page().width}
          height={mobile() ? cover() + 210 : cover() + 48}
          display="flex"
          flexDirection={mobile() ? 'column' : 'row'}
          gap={tv() ? S(10) : S(6)}
          alignItems={mobile() ? 'flexStart' : 'center'}
        >
          <Cover
            album={featured()}
            size={cover()}
            radius={tv() ? R.large : R.medium}
          />
          <view
            width={mobile() ? page().width : undefined}
            display="flex"
            flexDirection="column"
            gap={S(3)}
          >
            <view
              display="flex"
              flexDirection="row"
              alignItems="center"
              gap={S(2)}
            >
              <PulseDot color={C.accent} size={7} />
              <text fontSize={T.caption} color={C.accent} letterSpacing={1.4}>
                RECENTLY PLAYED
              </text>
            </view>
            <text
              width={mobile() ? page().width : tv() ? 820 : 480}
              contain="width"
              fontSize={tv() ? T.display : T.title}
              color={C.text}
            >
              {featured().title}
            </text>
            <text fontSize={tv() ? T.headline : T.body} color={C.muted}>
              {`${featured().artist}, ${featured().year}, ${formatTotal(albumSeconds(featured()))}`}
            </text>
            <Row gap={S(3)} scroll="none">
              <GradientButton
                label="Play"
                width={tv() ? 168 : 128}
                height={tv() ? 60 : 44}
                autofocus={tv()}
              />
              <GhostButton
                label="Shuffle"
                width={tv() ? 148 : 112}
                height={tv() ? 60 : 44}
              />
              <IconButton glyph="dots" label="More" size={tv() ? 60 : 44} />
            </Row>
          </view>
        </view>

        <For each={RAILS}>
          {(rail) => (
            <Rail
              title={rail.title}
              albums={rail.albums}
              family={props.family}
              width={railWidth()}
              cardSize={card()}
              hiddenCard={props.hiddenCard}
              onOpenAlbum={props.onOpenAlbum}
            />
          )}
        </For>

        <view height={S(12)} />
      </Column>
    </view>
  );
}
