/** Discover: the editorial hero and four peeking poster rails. */
import { createEffect, For } from 'solid-js';
import { SAMPLE, RAILS } from '../catalog';
import type { DiscoverState } from '../state';
import { C, type Metrics } from '../theme';
import { Hero } from '../components/Hero';
import { Rail } from '../components/Rail';

export function Discover(props: {
  state: DiscoverState;
  metrics: Metrics;
  saved: ReadonlySet<number>;
  onOpen: (title: (typeof SAMPLE.trending)[number]) => void;
  onToggleSaved: (title: (typeof SAMPLE.trending)[number]) => void;
}) {
  const m = () => props.metrics;
  const firstBlock = () => m().heroH + 26;
  const block = () => m().cardH + 82;
  const contentH = () => firstBlock() + RAILS.length * block() + 40;

  createEffect(() => {
    props.state.page.layout(contentH(), m().height);
  });

  const heroTitle = () =>
    props.state.rails().trending.items[0] ?? SAMPLE.trending[0];

  return (
    <view
      x={0}
      y={0}
      width={m().width}
      height={m().height}
      color={C.background}
      clipping
      onPointerDrag={(phase, point, origin) =>
        props.state.page.drag(phase, point, origin)
      }
    >
      <Hero
        title={heroTitle()}
        metrics={m()}
        page={props.state.page}
        saved={props.saved.has(heroTitle()?.id ?? -1)}
        onOpen={props.onOpen}
        onToggleSaved={props.onToggleSaved}
      />

      <For each={RAILS}>
        {(rail, index) => {
          const y = () =>
            firstBlock() + index() * block() - props.state.page.offset();
          const state = () => props.state.rails()[rail.key];
          return (
            <>
              <view
                x={m().margin}
                y={y()}
                width={m().width - 2 * m().margin}
                height={30}
              >
                <text fontSize={21} color={C.textPrimary}>
                  {rail.label}
                </text>
                <view
                  x={m().width - 2 * m().margin - 84}
                  y={-12}
                  width={84}
                  height={48}
                  onMouseClick={
                    index() === 0 ? () => props.state.reload() : undefined
                  }
                >
                  <text
                    y={18}
                    width={84}
                    contain="width"
                    textAlign="right"
                    fontSize={10}
                    letterSpacing={1}
                    color={C.dim}
                  >
                    {index() === 0
                      ? 'REFRESH'
                      : `${state().items.length || 10} TITLES`}
                  </text>
                </view>
              </view>
              <Rail
                x={m().margin}
                y={y() + 30}
                width={m().width - 2 * m().margin}
                metrics={m()}
                items={state().items}
                loading={state().loading}
                scroller={props.state.railScrollers[rail.key]}
                page={props.state.page}
                onOpen={props.onOpen}
              />
            </>
          );
        }}
      </For>
    </view>
  );
}
