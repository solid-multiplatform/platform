/**
 * The static part of the UI gallery: layout, text, images, effects, states,
 * motion and the focus containers. Nothing here moves unless a key or the
 * pointer asks for it.
 */
import { createSignal, For } from 'solid-js';
import { Column, Grid, Row } from '@solid-multiplatform/platform/primitives';
import {
  ACCENT,
  Button,
  Caption,
  contentWidth,
  interactive,
  MUTED,
  PANEL,
  Screen,
  TEXT,
} from '../ui';

const SWATCHES = [0x4fb3ffff, 0x7bd88fff, 0xffc857ff, 0xff7a90ff, 0xb58cffff];
const swatch = (index: number) => SWATCHES[index % SWATCHES.length]!;

const numbers = (count: number) => Array.from({ length: count }, (_, i) => i);

// ---- Layout

function Boxes(props: { count: number; size?: number; grow?: boolean }) {
  return (
    <For each={numbers(props.count)}>
      {(i) => (
        <view
          width={props.size ?? 44}
          height={props.size ?? 44}
          flexGrow={props.grow ? i + 1 : undefined}
          color={swatch(i)}
        />
      )}
    </For>
  );
}

export function LayoutScreen() {
  const panel = { width: 220, height: 200, color: PANEL };
  return (
    <Screen title="Layout">
      <view skipFocus width={contentWidth()} height={480}>
        <Caption>flex row, gap 8</Caption>
        <view
          y={28}
          {...panel}
          display="flex"
          flexDirection="row"
          flexBoundary="fixed"
          gap={8}
        >
          <Boxes count={3} />
        </view>
        <Caption x={240}>flex column, centred</Caption>
        <view
          x={240}
          y={28}
          {...panel}
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          gap={8}
        >
          <Boxes count={3} />
        </view>
        <Caption x={480}>flex wrap</Caption>
        <view
          x={480}
          y={28}
          {...panel}
          display="flex"
          flexDirection="row"
          flexWrap="wrap"
          gap={8}
        >
          <Boxes count={9} size={56} />
        </view>
        <Caption x={720}>flex grow 1 : 2 : 3</Caption>
        <view x={720} y={28} {...panel} display="flex" flexDirection="row">
          <Boxes count={3} grow />
        </view>
        <Caption y={248}>absolute: x and y inside the parent</Caption>
        <view y={276} {...panel} width={460}>
          <For each={numbers(5)}>
            {(i) => (
              <view
                x={20 + i * 70}
                y={20 + i * 22}
                width={120}
                height={70}
                color={swatch(i)}
              />
            )}
          </For>
        </view>
      </view>
    </Screen>
  );
}

// ---- Text

const LONG =
  'One scene on every screen: this sentence is long enough to wrap onto ' +
  'several lines inside its box, so that wrapping and the line limit show.';

export function TextScreen() {
  return (
    <Screen title="Text">
      <view skipFocus width={contentWidth()} height={520}>
        <Caption>textAlign: left, center, right (width 360)</Caption>
        <For each={['left', 'center', 'right'] as const}>
          {(align, i) => (
            <view y={28 + i() * 44} width={360} height={38} color={PANEL}>
              <text
                width={360}
                contain="width"
                textAlign={align}
                fontSize={24}
                color={TEXT}
              >
                {align}
              </text>
            </view>
          )}
        </For>
        <Caption y={172}>wrapping in 420</Caption>
        <view y={200} width={420} height={150} color={PANEL}>
          <text width={420} contain="width" fontSize={22} color={TEXT}>
            {LONG}
          </text>
        </view>
        <Caption x={460} y={172}>
          maxLines 2
        </Caption>
        <view x={460} y={200} width={420} height={150} color={PANEL}>
          <text
            width={420}
            contain="width"
            maxLines={2}
            fontSize={22}
            color={TEXT}
          >
            {LONG}
          </text>
        </view>
        <Caption y={366}>
          fontWeight 400 and 700 (700 draws only with a bold face loaded)
        </Caption>
        <text y={394} fontSize={30} fontWeight={400} color={TEXT}>
          Regular 400
        </text>
        <text x={260} y={394} fontSize={30} fontWeight={700} color={TEXT}>
          Bold 700
        </text>
        <Caption y={446}>sizes 16, 24, 40</Caption>
        <text y={474} fontSize={16} color={ACCENT}>
          sixteen
        </text>
        <text x={120} y={468} fontSize={24} color={ACCENT}>
          twenty-four
        </text>
        <text x={300} y={456} fontSize={40} color={ACCENT}>
          forty
        </text>
      </view>
    </Screen>
  );
}

// ---- Images

// An 8 by 8 checkerboard, inline: the gallery needs no network and no asset
// pipeline to show a texture.
const CHECKER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAHElEQVR4nGP4f8Lmv//m//9x0Qz4JEE0w7AwAQAK1cBB3qtoEAAAAABJRU5ErkJggg==';

export function ImagesScreen() {
  return (
    <Screen title="Images">
      <view skipFocus width={contentWidth()} height={260}>
        <Caption>src (8 by 8, scaled to 160)</Caption>
        <view y={28} width={160} height={160} src={CHECKER} />
        <Caption x={200}>rounded</Caption>
        <view
          x={200}
          y={28}
          width={160}
          height={160}
          src={CHECKER}
          borderRadius={32}
        />
        <Caption x={400}>tinted, alpha 0.6</Caption>
        <view
          x={400}
          y={28}
          width={160}
          height={160}
          src={CHECKER}
          color={0xff7a90ff}
          alpha={0.6}
        />
        <Caption x={600}>stretched 280 by 120</Caption>
        <view x={600} y={28} width={280} height={120} src={CHECKER} />
      </view>
    </Screen>
  );
}

// ---- Effects

export function EffectsScreen() {
  return (
    <Screen title="Effects">
      <view skipFocus width={contentWidth()} height={420}>
        <Caption>borderRadius 24</Caption>
        <view
          y={28}
          width={180}
          height={120}
          color={ACCENT}
          borderRadius={24}
        />
        <Caption x={220}>border 4</Caption>
        <view
          x={220}
          y={28}
          width={180}
          height={120}
          color={PANEL}
          border={{ color: 0xffc857ff, w: 4 }}
        />
        <Caption x={440}>rounded border</Caption>
        <view
          x={440}
          y={28}
          width={180}
          height={120}
          color={PANEL}
          borderRadius={24}
          border={{ color: 0x7bd88fff, w: 4 }}
        />
        <Caption y={180}>linearGradient</Caption>
        <view
          y={208}
          width={180}
          height={120}
          linearGradient={{
            colors: [0x4fb3ffff, 0xb58cffff, 0xff7a90ff],
            stops: [0, 0.5, 1],
            angle: Math.PI / 2,
          }}
        />
        <Caption x={220} y={180}>
          radialGradient
        </Caption>
        <view
          x={220}
          y={208}
          width={180}
          height={120}
          radialGradient={{
            colors: [0xffc857ff, 0x0b1118ff],
            stops: [0, 1],
            w: 180,
            h: 120,
            pivot: [0.5, 0.5],
          }}
        />
        <Caption x={440} y={180}>
          shadow
        </Caption>
        <view
          x={456}
          y={220}
          width={150}
          height={90}
          color={0xf2f6faff}
          borderRadius={12}
          shadow={{ color: 0x000000cc, x: 8, y: 8, blur: 24, spread: 2 }}
        />
      </view>
    </Screen>
  );
}

// ---- States

export function StatesScreen() {
  const [presses, setPresses] = createSignal(0);
  const tile = (name: string, style: object) => (
    <view
      width={220}
      height={120}
      style={{ color: 0x243145ff, borderRadius: 12, ...style }}
      onEnter={() => {
        setPresses((count) => count + 1);
      }}
    >
      <text x={16} y={44} fontSize={22} color={TEXT}>
        {name}
      </text>
    </view>
  );
  return (
    <Screen title="States">
      <Caption>
        Focus with the arrows, hover and press with a pointer, Enter or click.
      </Caption>
      <Row height={120} gap={16} scroll="none">
        {tile('$focus', { $focus: { color: 0x385f92ff } })}
        {tile('$focus + $hover', {
          $focus: { color: 0x385f92ff },
          $hover: { color: 0x7bd88f99 },
        })}
        {tile('all three', {
          $focus: { color: 0x385f92ff },
          $hover: { color: 0x7bd88f99 },
          $pressed: { color: 0xff7a90ff },
        })}
      </Row>
      <text skipFocus fontSize={22} color={MUTED}>
        {`Activated ${presses()} times`}
      </text>
    </Screen>
  );
}

// ---- Motion: every animation starts from a key or a click and ends.

export function MotionScreen() {
  const [moved, setMoved] = createSignal(false);
  const [faded, setFaded] = createSignal(false);
  const [grown, setGrown] = createSignal(false);
  return (
    <Screen title="Transitions">
      <Row height={48} gap={16} scroll="none">
        <Button label="Move" width={180} onEnter={() => setMoved((v) => !v)} />
        <Button label="Fade" width={180} onEnter={() => setFaded((v) => !v)} />
        <Button label="Scale" width={180} onEnter={() => setGrown((v) => !v)} />
      </Row>
      <view skipFocus width={contentWidth()} height={220} color={PANEL}>
        <view
          x={moved() ? 520 : 40}
          y={60}
          width={100}
          height={100}
          color={ACCENT}
          borderRadius={16}
          alpha={faded() ? 0.2 : 1}
          scale={grown() ? 1.5 : 1}
          transition={{
            x: { duration: 400, easing: 'ease-in-out' },
            alpha: { duration: 300 },
            scale: { duration: 300 },
          }}
        />
      </view>
      <Caption>
        Nothing runs between presses: see Diagnostics for the frame counter.
      </Caption>
    </Screen>
  );
}

// ---- Row, Column, Grid

function Tile(props: {
  label: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}) {
  return (
    <view
      x={props.x}
      y={props.y}
      width={props.width ?? 120}
      height={props.height ?? 56}
      style={interactive}
      onEnter={() => true}
    >
      <text x={12} y={14} fontSize={20} color={TEXT}>
        {props.label}
      </text>
    </view>
  );
}

export function ContainersScreen() {
  return (
    <Screen title="Row, Column, Grid">
      <Caption>Row: Left and Right</Caption>
      <Row height={56} gap={12} scroll="none">
        <For each={numbers(5)}>{(i) => <Tile label={`Row ${i + 1}`} />}</For>
      </Row>
      <Caption>Column: Up and Down</Caption>
      <Column height={124} gap={12} scroll="none">
        <For each={numbers(2)}>
          {(i) => <Tile label={`Column ${i + 1}`} width={220} />}
        </For>
      </Column>
      <Caption>Grid: four columns, all four arrows</Caption>
      <view height={136} width={contentWidth()} forwardFocus={0}>
        <Grid
          items={numbers(8)}
          columns={4}
          itemWidth={132}
          itemHeight={68}
          scroll="none"
        >
          {(cell) => (
            <Tile x={cell.x} y={cell.y} label={`Grid ${cell.item + 1}`} />
          )}
        </Grid>
      </view>
    </Screen>
  );
}
