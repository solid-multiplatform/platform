import { createSignal, Show, type JSX } from 'solid-js';
import { clampSize, useViewport } from '@solid-multiplatform/platform/app';
import {
  Alert,
  Checkbox,
  Column,
  Drawer,
  Markdown,
  Modal,
  Popover,
  RadioGroup,
  Slider,
  Switch,
} from '@solid-multiplatform/platform/primitives';
import type { UiFamily } from '../family';
import { C, R, S, T } from '../theme';
import { pageLayout } from '../layout';
import { GhostButton } from './Library';

const ABOUT_TITLE = 'Sona';
const ABOUT_BODY =
  'A gallery built on Solid Multiplatform. One scene, three shells: a phone app, a ten-foot TV app and a desktop app.';
const ABOUT_POINTS = [
  'Every primitive appears in a real flow',
  'Covers and icons are drawn from data',
  'The performance lab measures the frame budget where it runs',
];
const ABOUT = `## ${ABOUT_TITLE}\n\n${ABOUT_BODY}\n\n- ${ABOUT_POINTS.join('\n- ')}`;

/**
 * The About card's own geometry, derived from the viewport alone.
 *
 * The card is sized the way the framework's `Alert` is: an explicit height
 * from a generous line estimate, capped to the safe content room, with the
 * action row pinned inside the card's bottom. Nothing in the card's box
 * then depends on when text measurement settles — the card is the same
 * shape at open time and after a late re-measure, on every screen the app
 * ships to.
 */
function aboutCard(viewport: () => ReturnType<typeof useViewport>) {
  const v = viewport;
  const safe = () => v().insets.safeArea;
  // The card is centred in the safe content room, so its width clamps to
  // that room too: a notched landscape phone has 47 units of inset each
  // side, and a card clamped only to the window ends up under the notch.
  const width = () =>
    clampSize(520, 240, v().width - safe().left - safe().right, 24);
  const x = () =>
    safe().left +
    Math.max(24, (v().width - safe().left - safe().right - width()) / 2);
  // The room the card may occupy: the safe area minus a gutter each side.
  const room = () =>
    Math.max(
      0,
      v().height -
        safe().top -
        Math.max(safe().bottom, v().insets.ime.bottom) -
        48,
    );
  const padding = S(6);
  const gap = S(4);
  const action = 44;

  // A generous wrap estimate of the Markdown at the card's content width
  // (the same per-character 0.55 the framework's fallback measurer uses, so
  // the card never under-reserves what the unmeasured text asks for). An
  // over-estimate only grows the card inside its cap; an under-estimate
  // leaves the surplus to the content region, which scrolls.
  const content = () => {
    const inner = width() - padding * 2;
    const lines = (text: string, size: number, at = inner) => {
      const perLine = Math.max(8, Math.floor(at / (size * 0.55)));
      let count = 0;
      for (const paragraph of text.split('\n'))
        count += Math.max(1, Math.ceil(paragraph.length / perLine));
      return count;
    };
    const heading = 21; // round(T.body * 1.3), one line for a short title
    const body = lines(ABOUT_BODY, T.body) * T.body * 1.35;
    // A list item wraps in the width left of its bullet (22 + 8 gap).
    const points = ABOUT_POINTS.reduce(
      (total, point) =>
        total + lines(point, T.body, inner - 30) * T.body * 1.35,
      0,
    );
    return (
      heading * 1.35 + 10 + body + 10 + points + 6 * (ABOUT_POINTS.length - 1)
    );
  };

  const height = () => Math.min(room(), padding * 2 + content() + gap + action);
  const y = () => safe().top + Math.max(24, (room() - height()) / 2);
  // The Markdown's region: whatever of the card is left above the action row.
  const regionHeight = () => Math.max(0, height() - padding * 2 - gap - action);
  return { x, y, width, height, padding, gap, action, regionHeight };
}

export function Settings(props: {
  family: UiFamily;
  width: number;
  height: number;
  x?: number;
  topNav?: JSX.Element;
}): JSX.Element {
  const tv = () => props.family === 'tv';
  const mobile = () => props.family === 'mobile';
  const viewport = useViewport;
  const card = aboutCard(viewport);
  const width = () => props.width;
  const page = () => pageLayout(width(), props.family);
  // A settings column reads best narrow. It hangs off the page box's leading
  // edge rather than centring inside it: every screen's left edge is then the
  // same x, whichever screen you are on.
  const content = () => Math.min(720, page().width);
  const innerX = () => page().x;

  // The Advanced drawer's own geometry: the panel clamps to the window and
  // insets its content column by 24 each side (plus the trailing safe area),
  // and the rows inside add S(4) of padding. Sizing the rows from the same
  // numbers keeps every control inside the panel, on a window narrower than
  // the drawer as on one wider than it.
  const drawerInner = () =>
    Math.max(
      0,
      Math.min(tv() ? 520 : 360, viewport().width) -
        48 -
        viewport().insets.safeArea.right -
        S(8),
    );

  const [theme, setTheme] = createSignal<'system' | 'dark' | 'light'>('dark');
  const [quality, setQuality] = createSignal<'auto' | 'high' | 'saver'>('auto');
  const [crossfade, setCrossfade] = createSignal(true);
  const [crossfadeSeconds, setCrossfadeSeconds] = createSignal(6);
  const [about, setAbout] = createSignal(false);
  const [advanced, setAdvanced] = createSignal(false);
  const [info, setInfo] = createSignal(false);
  const [reset, setReset] = createSignal(false);

  const section = (title: string, node: JSX.Element) => (
    <view
      display="flex"
      flexDirection="column"
      gap={S(3)}
      width={content()}
      color={C.surface}
      borderRadius={R.medium}
      padding={S(5)}
    >
      <text fontSize={T.caption} color={C.muted} letterSpacing={0.8}>
        {title.toUpperCase()}
      </text>
      {node}
    </view>
  );

  return (
    <view width={width()} height={props.height} clipping>
      <Column
        x={innerX()}
        y={S(6)}
        width={content()}
        height={props.height - S(6)}
        gap={S(6)}
        scroll={tv() ? 'edge' : 'touch'}
        selected={0}
      >
        {props.topNav}
        <view
          width={content()}
          height={tv() ? 120 : 58}
          display="flex"
          flexDirection="column"
          gap={S(1)}
          justifyContent="flexStart"
        >
          <text fontSize={tv() ? T.display : T.title} color={C.text}>
            Settings
          </text>
          <text fontSize={tv() ? T.body : T.caption} color={C.muted}>
            Dialogs, drawers and popovers in their real places
          </text>
        </view>

        {section(
          'Appearance',
          <RadioGroup
            value={theme()}
            options={[
              { value: 'system', label: 'Follow the system' },
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
            onChange={setTheme}
            rowHeight={tv() ? 60 : 44}
            width={content() - S(10)}
          />,
        )}

        {section(
          'Playback',
          <view display="flex" flexDirection="column" gap={S(3)}>
            <Switch
              label="Crossfade between tracks"
              checked={crossfade()}
              onChange={setCrossfade}
              height={tv() ? 60 : 44}
              width={content() - S(10)}
            />
            <Show when={crossfade()}>
              <Slider
                label={`Crossfade ${crossfadeSeconds()} s`}
                value={crossfadeSeconds()}
                min={1}
                max={12}
                step={1}
                onChange={setCrossfadeSeconds}
                height={tv() ? 60 : 44}
                width={content() - S(10)}
              />
            </Show>
            <RadioGroup
              value={quality()}
              options={[
                { value: 'auto', label: 'Automatic quality' },
                { value: 'high', label: 'High quality' },
                { value: 'saver', label: 'Data saver' },
              ]}
              onChange={setQuality}
              rowHeight={tv() ? 60 : 44}
              width={content() - S(10)}
            />
          </view>,
        )}

        {section(
          'Library',
          <view display="flex" flexDirection="column" gap={S(3)}>
            <view
              display="flex"
              flexDirection={mobile() ? 'column' : 'row'}
              gap={S(3)}
            >
              <GhostButton
                label="Advanced"
                onPress={() => setAdvanced(true)}
                width={mobile() ? content() - S(10) : tv() ? 180 : 140}
                height={tv() ? 56 : 44}
              />
              <GhostButton
                label="About Sona"
                onPress={() => setAbout(true)}
                width={mobile() ? content() - S(10) : tv() ? 180 : 160}
                height={tv() ? 56 : 44}
              />
              <GhostButton
                label="What is measured?"
                onPress={() => setInfo(true)}
                width={mobile() ? content() - S(10) : tv() ? 260 : 190}
                height={tv() ? 56 : 44}
              />
            </view>
            <text fontSize={T.caption} color={C.dim}>
              Reset removes the local transcript and the generated covers.
            </text>
            <GhostButton
              label="Reset library"
              onPress={() => setReset(true)}
              width={mobile() ? content() - S(10) : tv() ? 200 : 160}
              height={tv() ? 56 : 44}
            />
          </view>,
        )}

        <view height={S(10)} />
      </Column>

      <Modal
        visible={about()}
        onRequestClose={() => setAbout(false)}
        label="About Sona"
        useSafeArea={false}
        initialFocus={undefined}
      >
        {/* The card carries an explicit height capped to the safe room, and
            every row inside it an explicit box: the Close action is pinned to
            the card's own bottom edge, so no measurement — early, late, or
            wider than the estimate — can push it out of the card, and the
            card itself cannot leave the safe area. */}
        <view
          x={card.x()}
          y={card.y()}
          width={card.width()}
          height={card.height()}
          color={C.surface}
          borderRadius={R.medium}
          onMouseClick={() => true}
        >
          {/* Long text scrolls in the region above the action row instead of
              pushing it; on a TV remote there is nothing to scroll and the
              audit reads the full region. */}
          <Column
            x={card.padding}
            y={card.padding}
            width={card.width() - card.padding * 2}
            height={card.regionHeight()}
            scroll={tv() ? 'none' : 'touch'}
            clipping
          >
            <Markdown
              source={ABOUT}
              width={card.width() - card.padding * 2}
              fontSize={T.body}
              color={C.text}
            />
          </Column>
          <view
            x={card.padding}
            y={card.height() - card.padding - card.action}
            width={card.width() - card.padding * 2}
            height={card.action}
            display="flex"
            flexDirection="row"
            justifyContent="flexEnd"
          >
            <GhostButton label="Close" onPress={() => setAbout(false)} />
          </view>
        </view>
      </Modal>

      <Drawer
        visible={advanced()}
        onRequestClose={() => setAdvanced(false)}
        label="Advanced"
        title="Advanced"
        side="end"
        width={tv() ? 520 : 360}
      >
        <view display="flex" flexDirection="column" gap={S(4)} padding={S(4)}>
          <Checkbox
            label="Keep a local cache"
            checked={() => true}
            width={drawerInner()}
            height={tv() ? 60 : 44}
          />
          <Checkbox
            label="Log frame times"
            checked={() => false}
            width={drawerInner()}
            height={tv() ? 60 : 44}
          />
          <GhostButton label="Close" onPress={() => setAdvanced(false)} />
        </view>
      </Drawer>

      <Popover
        visible={info()}
        onRequestClose={() => setInfo(false)}
        label="What is measured?"
        anchor={() => {
          const v = viewport();
          const height = tv() ? 56 : 44;
          // The button's unscrolled position is the honest anchor on a tall
          // screen; a short or rotated one clamps it into the visible room,
          // because the popover can only flip around a point that is on
          // screen. Anchoring past the fold put the panel itself past it.
          const y = Math.min(
            tv() ? 500 : 430,
            v.height - v.insets.safeArea.bottom - height - 8,
          );
          return {
            x: (props.x ?? 0) + innerX() + (tv() ? 180 : 140),
            y,
            width: tv() ? 180 : 160,
            height,
          };
        }}
        width={300}
        height={190}
      >
        <view
          padding={S(4)}
          width={300}
          display="flex"
          flexDirection="column"
          gap={S(2)}
        >
          <text fontSize={T.label} color={C.text}>
            The frame budget
          </text>
          <text fontSize={T.caption} color={C.muted}>
            One panel period: 16.7 ms at 60 Hz, 8.3 ms at 120. The lab reports
            p50 and p99 of the interval and the frame's own work, so a slow
            frame is distinguishable from a rate request that did not land.
          </text>
        </view>
      </Popover>

      <Alert
        visible={reset()}
        title="Reset the library?"
        message="The local transcript and every generated cover will be recreated on the next launch."
        confirmLabel="Reset"
        destructive
        onConfirm={() => setReset(false)}
        onCancel={() => setReset(false)}
        onRequestClose={() => setReset(false)}
      />
    </view>
  );
}
