import { createSignal, For, Show, type JSX } from 'solid-js';
import {
  ContextMenu,
  Column,
  Markdown,
  Menu,
  SelectableText,
  Tooltip,
} from '@solid-multiplatform/platform/primitives';
import { Cover } from '../components/Cover';
import { albumSeconds, type Album } from '../data';
import type { UiFamily } from '../family';
import { C, formatTime, formatTotal, R, S, T } from '../theme';
import { GhostButton, GradientButton, IconButton } from './Library';

const NOTES = (album: Album): string =>
  `## About *${album.title}*\n\nRecorded over two winters in a room with one window. The ${album.genre.toLowerCase()} arrangements were cut live, mostly first takes.\n\n- Produced by ${album.artist}\n- Mixed at night\n- Mastered for headphones and for a kitchen radio`;

export function AlbumScreen(props: {
  album: Album;
  family: UiFamily;
  width: number;
  height: number;
  /** The screen's x in the scene, for overlays anchored by hand. */
  x?: number;
  onBack?(): void;
  topNav?: JSX.Element;
}): JSX.Element {
  const tv = () => props.family === 'tv';
  const mobile = () => props.family === 'mobile';
  const pad = () => (tv() ? S(10) : mobile() ? S(5) : S(6));
  const width = () => props.width;
  const cover = () => (tv() ? 360 : mobile() ? width() - 2 * pad() : 280);

  const [menu, setMenu] = createSignal(false);
  const [contextAt, setContextAt] = createSignal<{ x: number; y: number }>();
  const [tip, setTip] = createSignal(false);

  const actions = () => (
    <view width={tv() ? 460 : 348} height={tv() ? 60 : 44}>
      <GradientButton
        label="Play"
        width={tv() ? 168 : 128}
        height={tv() ? 60 : 44}
      />
      <view
        x={tv() ? 180 : 140}
        onPointerEnter={() => setTip(true)}
        onPointerLeave={() => setTip(false)}
      >
        <GhostButton
          label="Shuffle"
          width={tv() ? 148 : 112}
          height={tv() ? 60 : 44}
        />
      </view>
      <IconButton
        x={tv() ? 340 : 264}
        glyph="dots"
        label="More"
        size={tv() ? 60 : 44}
        onPress={() => setMenu(true)}
      />
    </view>
  );

  return (
    <view width={width()} height={props.height} clipping>
      <Column
        width={width()}
        height={props.height}
        gap={S(6)}
        scroll={tv() ? 'auto' : 'touch'}
        selected={0}
      >
        {props.topNav}
        <view
          width={width()}
          height={tv() ? 110 : 76}
          display="flex"
          flexDirection="row"
          alignItems="flexEnd"
          justifyContent="spaceBetween"
          padding={[0, pad()]}
        >
          <GhostButton label="Back" onPress={props.onBack} />
          <text fontSize={T.caption} color={C.dim}>
            {props.album.genre}
          </text>
        </view>

        <view
          width={width()}
          height={mobile() ? cover() + 210 : cover() + 40}
          padding={[0, pad()]}
        >
          <view
            onPointerContext={(point) =>
              setContextAt({ x: point.x, y: point.y })
            }
          >
            <view x={pad()}>
              <Cover
                album={props.album}
                size={cover()}
                radius={tv() ? R.large : R.medium}
              />
            </view>
          </view>
          <view
            x={pad() + (mobile() ? 0 : cover() + S(6))}
            y={mobile() ? cover() + S(5) : 0}
            display="flex"
            flexDirection="column"
            gap={S(3)}
            width={mobile() ? width() - 2 * pad() : tv() ? 820 : 560}
          >
            <text fontSize={T.caption} color={C.accent} letterSpacing={1.4}>
              {`ALBUM · ${props.album.year}`}
            </text>
            <text
              width={mobile() ? width() - 2 * pad() : tv() ? 820 : 560}
              contain="width"
              fontSize={tv() ? T.display : T.title}
              color={C.text}
            >
              {props.album.title}
            </text>
            <text fontSize={tv() ? T.headline : T.body} color={C.muted}>
              {`${props.album.artist} · ${props.album.tracks.length} tracks · ${formatTotal(albumSeconds(props.album))}`}
            </text>
            {actions()}
          </view>
        </view>

        {/* Tracks: a real list, focusable, with durations. */}
        <view
          width={width()}
          display="flex"
          flexDirection="column"
          padding={[0, pad()]}
        >
          <text fontSize={T.label} color={C.muted} letterSpacing={0.8}>
            {'TRACKS'}
          </text>
          <For each={props.album.tracks}>
            {(track, index) => (
              <view
                width={width() - 2 * pad()}
                height={tv() ? 64 : 52}
                style={{ $focus: { color: C.raised } }}
                onEnter={() => undefined}
                onMouseClick={() => undefined}
                cursorStyle="pointer"
              >
                <text
                  x={0}
                  y={tv() ? 22 : 18}
                  width={24}
                  textAlign="right"
                  fontSize={T.caption}
                  color={C.dim}
                >
                  {String(index() + 1)}
                </text>
                <text
                  x={40}
                  y={tv() ? 20 : 16}
                  width={width() - 2 * pad() - 120}
                  contain="width"
                  maxLines={1}
                  fontSize={tv() ? T.body : T.label}
                  color={C.text}
                >
                  {track.title}
                </text>
                <text
                  x={width() - 2 * pad() - 56}
                  y={tv() ? 24 : 19}
                  width={56}
                  textAlign="right"
                  fontSize={T.caption}
                  color={C.dim}
                >
                  {formatTime(track.seconds)}
                </text>
              </view>
            )}
          </For>
        </view>

        {/* Notes: Markdown, and a selectable credits line. */}
        <view
          width={width()}
          display="flex"
          flexDirection="column"
          gap={S(3)}
          padding={[0, pad()]}
        >
          <Markdown
            source={NOTES(props.album)}
            width={mobile() ? width() - 2 * pad() : tv() ? 900 : 620}
            fontSize={tv() ? 20 : T.body}
            color={C.text}
          />
          <SelectableText
            width={mobile() ? width() - 2 * pad() : tv() ? 900 : 620}
            fontSize={T.caption}
            color={C.dim}
          >
            {`© ${props.album.year} Sona Records. Recorded by ${props.album.artist}. Select this line and copy it.`}
          </SelectableText>
        </view>

        <view height={S(10)} />
      </Column>

      <Menu
        visible={menu}
        anchor={() => ({
          x: (props.x ?? 0) + pad() + (tv() ? 340 : 264),
          y: tv() ? 380 : 300,
          width: 180,
          height: 44,
        })}
        label="Album actions"
        items={[
          { label: 'Add to playlist', onSelect: () => undefined },
          { label: 'Share', onSelect: () => undefined },
          { label: 'Download', onSelect: () => undefined },
          { label: 'Delete', destructive: true, onSelect: () => undefined },
        ]}
        onRequestClose={() => setMenu(false)}
      />

      <ContextMenu
        visible={() => contextAt() !== undefined}
        point={() => ({
          x: contextAt()?.x ?? 0,
          y: contextAt()?.y ?? 0,
          width: 0,
          height: 0,
        })}
        items={[
          { label: 'Play next', onSelect: () => setContextAt(undefined) },
          { label: 'Copy link', onSelect: () => setContextAt(undefined) },
          {
            label: 'Remove',
            destructive: true,
            onSelect: () => setContextAt(undefined),
          },
        ]}
        onRequestClose={() => setContextAt(undefined)}
      />

      <Show when={tip()}>
        <Tooltip
          visible={tip()}
          anchor={() => ({
            x: (props.x ?? 0) + pad() + (tv() ? 180 : 140),
            y: tv() ? 380 : 300,
            width: tv() ? 148 : 112,
            height: tv() ? 60 : 44,
          })}
          label="Shuffle the album"
        />
      </Show>
    </view>
  );
}
