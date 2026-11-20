/** A title's details: backdrop, poster, overview, cast and a similar rail. */
import { createEffect, createMemo, on, Show } from 'solid-js';
import { Image, Text } from '@solid-multiplatform/platform/app';
import { scrollDebug } from '../config';
import { similarTo, type Title } from '../catalog';
import { createScroller } from '../scroller';
import { C, initials, type Metrics } from '../theme';
import { Rail } from './Rail';

function wrapLines(text: string, width: number, charWidth: number) {
  let lines = 0;
  for (const line of text.split('\n')) {
    lines += Math.max(
      1,
      Math.ceil(
        (line.length || 1) / Math.max(10, Math.floor(width / charWidth)),
      ),
    );
  }
  return lines;
}

export function Details(props: {
  title: Title;
  metrics: Metrics;
  onClose: () => void;
  onOpen: (title: Title) => void;
}) {
  const scroller = createScroller({ axis: 'y', debug: scrollDebug });
  const similarScroller = createScroller({
    axis: 'x',
    snap: () => props.metrics.cardW + props.metrics.cardGap,
    debug: scrollDebug,
  });
  const backdropH = () =>
    Math.round(Math.min(360, props.metrics.height * 0.33));
  const overviewWidth = () => props.metrics.width - 2 * props.metrics.margin;
  const overviewH = () =>
    wrapLines(props.title.overview, overviewWidth(), 8.35) * 23 + 8;
  const overviewY = () => backdropH() + 92;
  const castY = () => overviewY() + overviewH() + 30;
  const similarY = () => castY() + 154;
  const contentH = () =>
    similarY() + props.metrics.cardH + 60 + props.metrics.bottom + 30;
  const similar = createMemo(() => similarTo(props.title, 12));
  const cast = () => (props.title.cast ?? []).slice(0, 6);

  createEffect(
    on(
      () => props.title.id,
      () => scroller.to(0, 0),
      { defer: true },
    ),
  );
  createEffect(() => {
    scroller.layout(contentH(), props.metrics.height, 'top');
  });

  const meta = () => {
    const parts = [String(props.title.year)];
    if (props.title.runtime) {
      const hours = Math.floor(props.title.runtime / 60);
      const minutes = props.title.runtime % 60;
      parts.push(hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`);
    }
    parts.push(props.title.rating.toFixed(1));
    return parts.filter(Boolean).join('   ·   ');
  };

  return (
    <view
      x={0}
      y={0}
      width={props.metrics.width}
      height={props.metrics.height}
      color={C.background}
      zIndex={50}
      clipping
      onPointerDrag={(phase, point, origin) =>
        scroller.drag(phase, point, origin)
      }
    >
      <view
        x={0}
        y={-scroller.offset()}
        width={props.metrics.width}
        height={contentH()}
      >
        <view
          width={props.metrics.width}
          height={backdropH()}
          color={C.surface}
          clipping
        >
          <Image
            src={props.title.backdrop || props.title.poster}
            width={props.metrics.width}
            height={backdropH()}
            fit="cover"
            placeholderColor={C.skeletonStrong}
          />
          <view
            y={Math.round(backdropH() * 0.4)}
            width={props.metrics.width}
            height={Math.round(backdropH() * 0.6)}
            color={0x00000000}
            linearGradient={{
              colors: [0x0a0a0b00, C.background],
              angle: 0,
              stops: [0, 1],
            }}
          />
        </view>

        <view
          x={props.metrics.margin}
          y={backdropH() - 84}
          width={104}
          height={156}
          borderRadius={14}
          border={{ width: 1, color: 0xffffff2a }}
          color={C.surface}
          clipping
        >
          <Image
            src={props.title.poster}
            width={104}
            height={156}
            fit="cover"
            placeholderColor={C.skeletonStrong}
          />
        </view>

        <view
          x={props.metrics.margin + 120}
          y={backdropH() - 78}
          width={props.metrics.width - props.metrics.margin * 2 - 120}
        >
          <text
            width={props.metrics.width - props.metrics.margin * 2 - 120}
            contain="width"
            maxLines={2}
            overflowSuffix="…"
            fontSize={26}
            lineHeight={31}
            color={C.textPrimary}
          >
            {props.title.title}
          </text>
          <text y={70} fontSize={13} color={C.muted}>
            {meta()}
          </text>
          <text
            y={92}
            fontSize={13}
            color={C.dim}
            width={props.metrics.width - props.metrics.margin * 2 - 120}
            contain="width"
            maxLines={1}
            overflowSuffix="…"
          >
            {props.title.genres.join('  ·  ')}
          </text>
        </view>

        <view x={props.metrics.margin} y={overviewY()}>
          <Text
            selectable
            width={overviewWidth()}
            height={overviewH()}
            contain="both"
            fontSize={15.5}
            lineHeight={23}
            color={C.text}
          >
            {props.title.overview}
          </Text>
        </view>

        <view x={props.metrics.margin} y={castY()}>
          <text fontSize={12} letterSpacing={1.1} color={C.muted}>
            CAST
          </text>
          <Show
            when={cast().length > 0}
            fallback={
              <text y={30} fontSize={13} color={C.dim}>
                Cast unavailable
              </text>
            }
          >
            <view y={26}>
              {cast().map((name, index) => (
                <view x={index * 74} y={0} width={64} height={84}>
                  <view
                    width={52}
                    height={52}
                    color={C.surfaceHigh}
                    borderRadius={26}
                    border={{ width: 1, color: C.line }}
                  >
                    <text
                      y={16}
                      width={52}
                      contain="width"
                      textAlign="center"
                      fontSize={16}
                      color={C.text}
                    >
                      {initials(name)}
                    </text>
                  </view>
                  <text
                    y={60}
                    width={64}
                    contain="width"
                    maxLines={1}
                    overflowSuffix="…"
                    fontSize={11}
                    color={C.muted}
                  >
                    {name}
                  </text>
                </view>
              ))}
            </view>
          </Show>
        </view>

        <view x={props.metrics.margin} y={similarY() - 28}>
          <text fontSize={19} color={C.textPrimary}>
            More like this
          </text>
        </view>
        <Rail
          x={props.metrics.margin}
          y={similarY()}
          width={props.metrics.width - 2 * props.metrics.margin}
          metrics={props.metrics}
          items={similar()}
          loading={false}
          scroller={similarScroller}
          page={scroller}
          onOpen={props.onOpen}
        />
      </view>

      <view
        x={props.metrics.margin}
        y={props.metrics.top + 8}
        width={88}
        height={48}
        color={0x0a0a0bcc}
        borderRadius={24}
        border={{ width: 1, color: 0xffffff33 }}
        zIndex={20}
        onMouseClick={() => props.onClose()}
      >
        <text
          y={15}
          width={88}
          contain="width"
          textAlign="center"
          fontSize={14}
          color={C.text}
        >
          Back
        </text>
      </view>
    </view>
  );
}
