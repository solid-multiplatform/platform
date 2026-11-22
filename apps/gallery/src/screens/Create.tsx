import { createSignal, For, Show, type JSX } from 'solid-js';
import { TextField } from '@solid-multiplatform/platform/app';
import {
  Alert,
  Column,
  DatePicker,
  RadioGroup,
  Row,
  Select,
  Toast,
} from '@solid-multiplatform/platform/primitives';
import { Cover } from '../components/Cover';
import { ALBUMS, type Album, type Track } from '../data';
import type { UiFamily } from '../family';
import { C, formatTime, R, S, T } from '../theme';
import { pageLayout } from '../layout';
import { AnimatedNumber } from '../motion/numeric';
import { GhostButton, GradientButton, IconButton } from './Library';

interface Pick {
  album: Album;
  track: Track;
  index: number;
}

const PICKS: Pick[] = ALBUMS.slice(0, 3).flatMap((album) =>
  album.tracks.slice(0, 4).map((track, index) => ({ album, track, index })),
);

const PALETTES: [number, number][] = [
  [0xe2603fff, 0x2a1512ff],
  [0x2b3a67ff, 0x0d1220ff],
  [0x2f5d50ff, 0x0e1a17ff],
  [0x5a4b8cff, 0x141024ff],
];

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
// No Intl: the desktop runtime has no ICU, and a date label must not throw.
const fmtDate = (date: Date): string =>
  `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;

export function Create(props: {
  family: UiFamily;
  width: number;
  height: number;
  onDone?(): void;
  topNav?: JSX.Element;
}): JSX.Element {
  const tv = () => props.family === 'tv';
  const mobile = () => props.family === 'mobile';
  const width = () => props.width;
  const page = () => pageLayout(width(), props.family);

  const [name, setName] = createSignal('Late night');
  const [about, setAbout] = createSignal('');
  const [visibility, setVisibility] = createSignal<
    'private' | 'shared' | 'public'
  >('private');
  const [palette, setPalette] = createSignal(0);
  const [chosen, setChosen] = createSignal<ReadonlySet<number>>(
    new Set([0, 2, 5]),
  );
  const [sort, setSort] = createSignal<'album' | 'title' | 'longest'>('album');
  const [date, setDate] = createSignal(new Date(2026, 10, 21));
  const [dateOpen, setDateOpen] = createSignal(false);
  const [discard, setDiscard] = createSignal(false);
  const [toast, setToast] = createSignal(false);

  const dirty = () =>
    name() !== 'Late night' || about() !== '' || chosen().size !== 3;
  const toggle = (index: number) =>
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  const ordered = () => {
    const picks = [...PICKS];
    if (sort() === 'title')
      picks.sort((a, b) => a.track.title.localeCompare(b.track.title));
    else if (sort() === 'longest')
      picks.sort((a, b) => b.track.seconds - a.track.seconds);
    else picks.sort((a, b) => a.album.title.localeCompare(b.album.title));
    return picks;
  };

  const field = (label: string, node: JSX.Element) => (
    <view display="flex" flexDirection="column" gap={S(2)}>
      <text fontSize={T.caption} color={C.muted} letterSpacing={0.8}>
        {label.toUpperCase()}
      </text>
      {node}
    </view>
  );

  const cover = () => (
    <view display="flex" flexDirection="row" gap={S(3)} alignItems="center">
      <Cover
        album={{ ...ALBUMS[0]!, palette: PALETTES[palette()]! }}
        size={tv() ? 132 : 84}
        radius={R.medium}
        label={false}
      />
      <view width={(tv() ? 4 : 4) * 42} height={tv() ? 44 : 34}>
        <For each={PALETTES}>
          {(colors, index) => (
            <view
              x={index() * 42}
              width={tv() ? 44 : 34}
              height={tv() ? 44 : 34}
              borderRadius={R.small}
              border={{
                width: index() === palette() ? 2 : 1,
                color: index() === palette() ? C.accent : C.line,
              }}
              color={colors[0]}
              linearGradient={{ colors, angle: 120, stops: [0, 1] }}
              onEnter={() => {
                setPalette(index());
              }}
              onMouseClick={() => {
                setPalette(index());
              }}
              cursorStyle="pointer"
              ariaLabel={`Cover ${index() + 1}`}
            />
          )}
        </For>
      </view>
    </view>
  );

  // A two-column page: the form takes 45% (capped), the list the rest. On a
  // phone the two columns stack, so the form takes the whole page.
  const formWidth = () =>
    mobile() ? page().width : Math.min(tv() ? 560 : 400, page().width * 0.45);
  const listWidth = () =>
    mobile() ? page().width : page().width - formWidth() - S(8);

  const trackRow = (pick: Pick, index: number, rowWidth: number) => {
    const selected = () => chosen().has(index);
    return (
      <view
        width={rowWidth}
        height={tv() ? 64 : 50}
        display="flex"
        flexDirection="row"
        alignItems="center"
        gap={S(3)}
        onEnter={() => {
          toggle(index);
        }}
        onMouseClick={() => {
          toggle(index);
        }}
        cursorStyle="pointer"
        style={{ $focus: { color: C.raised } }}
      >
        <view
          width={20}
          height={20}
          borderRadius={10}
          border={{ width: 1, color: selected() ? C.accent : C.line }}
          color={selected() ? C.accent : 0x00000000}
        >
          <view
            width={6.5}
            height={2.4}
            x={3.3}
            y={10.3}
            rotation={0.785}
            color={selected() ? C.onAccent : 0x00000000}
          />
          <view
            width={10.3}
            height={2.4}
            x={6.6}
            y={8.9}
            rotation={-0.785}
            color={selected() ? C.onAccent : 0x00000000}
          />
        </view>
        <view
          display="flex"
          flexDirection="column"
          gap={1}
          width={rowWidth - 100}
        >
          <text
            fontSize={tv() ? T.body : T.label}
            color={C.text}
            contain="width"
            maxLines={1}
          >
            {pick.track.title}
          </text>
          <text
            fontSize={T.caption}
            color={C.muted}
            contain="width"
            maxLines={1}
          >
            {pick.album.title}
          </text>
        </view>
        <view
          width={S(14)}
          display="flex"
          flexDirection="row"
          justifyContent="flexEnd"
        >
          <text
            width={S(14)}
            textAlign="right"
            contain="width"
            fontSize={T.caption}
            color={C.dim}
          >
            {formatTime(pick.track.seconds)}
          </text>
        </view>
      </view>
    );
  };

  return (
    <view width={width()} height={props.height} clipping>
      <Column
        x={page().x}
        y={S(6)}
        width={page().width}
        height={props.height - S(6)}
        gap={S(6)}
        scroll={tv() ? 'edge' : 'touch'}
        selected={0}
      >
        {props.topNav}
        <view
          width={page().width}
          display="flex"
          flexDirection="row"
          alignItems="center"
          justifyContent="spaceBetween"
          height={tv() ? 120 : 58}
        >
          <view display="flex" flexDirection="column" gap={S(1)}>
            <text fontSize={tv() ? T.display : T.title} color={C.text}>
              New playlist
            </text>
            <text fontSize={tv() ? T.body : T.caption} color={C.muted}>
              A form in context: fields, pickers, choices, tracks, one accent
            </text>
          </view>
          <Show when={!mobile()}>
            <Row gap={S(3)} scroll="none">
              <GhostButton
                label="Cancel"
                onPress={() => (dirty() ? setDiscard(true) : props.onDone?.())}
              />
              <GradientButton
                label="Create"
                width={tv() ? 150 : 120}
                height={tv() ? 56 : 44}
                onPress={() => {
                  setToast(true);
                  props.onDone?.();
                }}
              />
            </Row>
          </Show>
        </view>

        <view
          width={page().width}
          display="flex"
          flexDirection={mobile() ? 'column' : 'row'}
          gap={tv() ? S(12) : S(8)}
        >
          {/* The form */}
          <view
            display="flex"
            flexDirection="column"
            gap={S(4)}
            width={formWidth()}
          >
            {/* The field carries its own label, so there is no section label
                above it: one control, one caption. */}
            <TextField
              label="Playlist name"
              value={name()}
              onChange={setName}
              height={tv() ? 56 : 48}
              width={formWidth()}
            />
            <TextField
              label="Description"
              placeholder="What is this for?"
              value={about()}
              onChange={setAbout}
              multiline
              height={tv() ? 104 : 88}
              width={formWidth()}
            />
            {field('Cover', cover())}
            {field(
              'Visible to',
              <RadioGroup
                value={visibility()}
                options={[
                  { value: 'private', label: 'Only me' },
                  { value: 'shared', label: 'People with the link' },
                  { value: 'public', label: 'Everyone' },
                ]}
                onChange={setVisibility}
                rowHeight={tv() ? 60 : 44}
                width={formWidth()}
              />,
            )}
            {field(
              'Release date',
              <view
                display="flex"
                flexDirection="row"
                gap={S(3)}
                alignItems="center"
                width={formWidth()}
                height={tv() ? 64 : 52}
                // The whole row is the control: the date and its calendar
                // button both open the picker.
                onMouseClick={() => setDateOpen(true)}
              >
                <GhostButton
                  label={fmtDate(date())}
                  width={180}
                  height={tv() ? 56 : 44}
                  onPress={() => setDateOpen(true)}
                />
                <IconButton
                  glyph="calendar"
                  label="Pick a date"
                  size={tv() ? 56 : 44}
                  onPress={() => setDateOpen(true)}
                />
              </view>,
            )}
            <Show when={mobile()}>
              <Row gap={S(3)} scroll="none">
                <GhostButton
                  label="Cancel"
                  width={(page().width - S(3)) / 2}
                  height={52}
                  onPress={() =>
                    dirty() ? setDiscard(true) : props.onDone?.()
                  }
                />
                <GradientButton
                  label="Create"
                  width={(page().width - S(3)) / 2}
                  height={52}
                  onPress={() => {
                    setToast(true);
                    props.onDone?.();
                  }}
                />
              </Row>
            </Show>
          </view>

          {/* The tracks */}
          <view
            display="flex"
            flexDirection="column"
            gap={S(3)}
            width={listWidth()}
          >
            <view
              display="flex"
              flexDirection="row"
              alignItems="center"
              justifyContent="spaceBetween"
            >
              <view
                display="flex"
                flexDirection="row"
                alignItems="center"
                gap={S(2)}
              >
                <text fontSize={tv() ? T.headline : T.label} color={C.text}>
                  Tracks,
                </text>
                <AnimatedNumber
                  value={chosen().size}
                  width={Math.round((tv() ? T.headline : T.label) * 0.62)}
                  height={Math.round((tv() ? T.headline : T.label) * 1.4)}
                  fontSize={tv() ? T.headline : T.label}
                  color={C.text}
                />
                <text fontSize={tv() ? T.headline : T.label} color={C.text}>
                  chosen
                </text>
              </view>
              <Select
                value={sort()}
                options={[
                  { value: 'album', label: 'Album' },
                  { value: 'title', label: 'Title' },
                  { value: 'longest', label: 'Longest first' },
                ]}
                onChange={setSort}
                label="Sort tracks"
                width={tv() ? 240 : 168}
                height={tv() ? 56 : 40}
              />
            </view>
            <view display="flex" flexDirection="column">
              <For each={ordered()}>
                {(pick, index) => trackRow(pick, index(), listWidth())}
              </For>
            </view>
          </view>
        </view>

        <view height={S(10)} />
      </Column>

      <DatePicker
        visible={dateOpen}
        value={date()}
        onChange={(next) => setDate(next)}
        onRequestClose={() => setDateOpen(false)}
        title="Release date"
      />

      <Alert
        visible={discard}
        title="Discard this playlist?"
        message="The name, cover and tracks you chose will be lost."
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          setDiscard(false);
          props.onDone?.();
        }}
        onCancel={() => setDiscard(false)}
        onRequestClose={() => setDiscard(false)}
      />

      <Toast
        visible={toast}
        message="Playlist created"
        duration={1800}
        onDismiss={() => setToast(false)}
      />
    </view>
  );
}
