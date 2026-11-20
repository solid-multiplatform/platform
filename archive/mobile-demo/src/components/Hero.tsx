/** The Discover hero: full-bleed backdrop, bottom scrim, pill actions. */
import { Image } from '@solid-multiplatform/platform/app';
import type { Scroller } from '../scroller';
import type { Title } from '../catalog';
import { C, type Metrics } from '../theme';

function Pill(props: {
  x: number;
  width: number;
  label: string;
  filled?: boolean;
  saved?: boolean;
  onPress: () => void;
}) {
  return (
    <view
      x={props.x}
      y={0}
      width={props.width}
      height={48}
      borderRadius={24}
      color={props.filled ? C.white : props.saved ? C.accentSoft : 0x0a0a0b99}
      border={{
        width: 1,
        color: props.filled ? C.white : props.saved ? C.accent : 0xffffff55,
      }}
      onMouseClick={() => props.onPress()}
    >
      <text
        y={15}
        width={props.width}
        contain="width"
        textAlign="center"
        fontSize={15}
        color={props.filled ? C.background : props.saved ? C.accent : C.text}
      >
        {props.label}
      </text>
    </view>
  );
}

export function Hero(props: {
  title: Title | undefined;
  metrics: Metrics;
  page: Scroller;
  saved: boolean;
  onOpen: (title: Title) => void;
  onToggleSaved: (title: Title) => void;
}) {
  const title = () => props.title;
  const titleText = () => title()?.title ?? '';
  const titleSize = () => (titleText().length > 30 ? 28 : 34);
  const titleLine = () => Math.round(titleSize() * 1.15);
  const titleLines = () =>
    Math.min(2, Math.ceil(titleText().length / (titleSize() === 34 ? 28 : 32)));
  const titleH = () => titleLines() * titleLine();
  const titleY = () => props.metrics.heroH - 100 - titleH();
  const meta = () => {
    const t = title();
    if (!t) return '';
    return [
      String(t.year),
      t.rating.toFixed(1),
      t.genres.slice(0, 2).join(' · '),
    ]
      .filter(Boolean)
      .join('   ·   ');
  };
  return (
    <view
      x={0}
      y={-props.page.offset()}
      width={props.metrics.width}
      height={props.metrics.heroH}
      onMouseClick={() => title() && props.onOpen(title()!)}
    >
      <view
        width={props.metrics.width}
        height={props.metrics.heroH}
        color={C.surface}
        clipping
      >
        <Image
          src={title()?.backdrop || title()?.poster || ''}
          width={props.metrics.width}
          height={props.metrics.heroH}
          fit="cover"
          placeholderColor={C.skeletonStrong}
        />
        {/* Top scrim: keeps the floating chrome legible over a bright frame. */}
        <view
          width={props.metrics.width}
          height={props.metrics.top + 150}
          color={0x00000000}
          linearGradient={{
            colors: [0x0a0a0be6, 0x0a0a0b00],
            angle: 0,
            stops: [0, 1],
          }}
        />
        {/* The editorial bottom scrim: the type sits in near-black, not on art. */}
        <view
          y={Math.round(props.metrics.heroH * 0.38)}
          width={props.metrics.width}
          height={Math.round(props.metrics.heroH * 0.62)}
          color={0x00000000}
          linearGradient={{
            colors: [0x0a0a0b00, 0x0a0a0bf2, C.background],
            angle: 0,
            stops: [0, 0.72, 1],
          }}
        />
      </view>

      <view
        x={props.metrics.margin}
        y={0}
        width={props.metrics.width - 2 * props.metrics.margin}
        height={props.metrics.heroH}
      >
        <text
          y={titleY() - 22}
          fontSize={11}
          letterSpacing={1.4}
          color={C.accent}
        >
          FEATURED
        </text>
        <text
          y={titleY()}
          width={props.metrics.width - 2 * props.metrics.margin}
          contain="width"
          maxLines={2}
          overflowSuffix="…"
          fontSize={titleSize()}
          lineHeight={titleLine()}
          color={C.textPrimary}
        >
          {titleText()}
        </text>
        <text y={props.metrics.heroH - 84} fontSize={13} color={C.muted}>
          {meta()}
        </text>
      </view>

      <view
        x={props.metrics.margin}
        y={props.metrics.heroH - 60}
        width={268}
        height={48}
        onPointerDrag={(phase, point, origin) =>
          props.page.drag(phase, point, origin)
        }
      >
        <Pill
          x={0}
          width={122}
          label="Play"
          filled
          onPress={() => title() && props.onOpen(title()!)}
        />
        <Pill
          x={134}
          width={122}
          label={props.saved ? 'Saved' : '+ List'}
          saved={props.saved}
          onPress={() => title() && props.onToggleSaved(title()!)}
        />
      </view>
    </view>
  );
}
