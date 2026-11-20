import { createSignal, type JSX } from 'solid-js';
import { useViewport } from '@solid-multiplatform/platform/app';
import {
  Alert,
  Checkbox,
  Column,
  Drawer,
  Markdown,
  Modal,
  Popover,
  RadioGroup,
} from '@solid-multiplatform/platform/primitives';
import type { UiFamily } from '../family';
import { C, R, S, T } from '../theme';
import { pageLayout } from '../layout';
import { GhostButton } from './Library';

const ABOUT = `## Sona\n\nA gallery built on Solid Multiplatform. One scene, three shells: a phone app, a ten-foot TV app and a desktop app.\n\n- Every primitive appears in a real flow\n- Covers and icons are drawn from data\n- The performance lab measures the frame budget where it runs`;

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
  const width = () => props.width;
  const page = () => pageLayout(width(), props.family);
  // A settings column reads best narrow. It hangs off the page box's leading
  // edge rather than centring inside it: every screen's left edge is then the
  // same x, whichever screen you are on.
  const content = () => Math.min(720, page().width);
  const innerX = () => page().x;

  const [theme, setTheme] = createSignal<'system' | 'dark' | 'light'>('dark');
  const [quality, setQuality] = createSignal<'auto' | 'high' | 'saver'>('auto');
  const [crossfade, setCrossfade] = createSignal(true);
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
        scroll={tv() ? 'auto' : 'touch'}
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
            <Checkbox
              label="Crossfade between tracks"
              checked={crossfade()}
              onChange={setCrossfade}
              height={tv() ? 60 : 44}
              width={content() - S(10)}
            />
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
        initialFocus={undefined}
      >
        <view
          x={Math.max(24, (viewport().width - 520) / 2)}
          y={Math.max(60, viewport().height / 2 - 220)}
          width={Math.min(520, viewport().width - 48)}
          color={C.surface}
          borderRadius={R.medium}
          padding={S(6)}
          display="flex"
          flexDirection="column"
          gap={S(4)}
          onMouseClick={() => true}
        >
          <Markdown
            source={ABOUT}
            width={Math.min(520, viewport().width - 48) - S(12)}
            fontSize={T.body}
            color={C.text}
          />
          <view display="flex" flexDirection="row" justifyContent="flexEnd">
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
            width={tv() ? 440 : 300}
            height={tv() ? 60 : 44}
          />
          <Checkbox
            label="Log frame times"
            checked={() => false}
            width={tv() ? 440 : 300}
            height={tv() ? 60 : 44}
          />
          <GhostButton label="Close" onPress={() => setAdvanced(false)} />
        </view>
      </Drawer>

      <Popover
        visible={info()}
        onRequestClose={() => setInfo(false)}
        label="What is measured?"
        anchor={() => ({
          x: (props.x ?? 0) + innerX() + (tv() ? 180 : 140),
          y: tv() ? 500 : 430,
          width: tv() ? 180 : 160,
          height: tv() ? 56 : 44,
        })}
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
