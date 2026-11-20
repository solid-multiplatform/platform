import type { JSX } from 'solid-js';

export type GlyphName =
  | 'library'
  | 'plus'
  | 'activity'
  | 'dots'
  | 'search'
  | 'filter'
  | 'calendar'
  | 'shuffle'
  | 'play';

/**
 * Icons drawn as scene views rather than SVG textures: a handful of bars and
 * rings that scale with the type, with no image decode and no atlas. (The
 * framework's `Icon` rasterizes an SVG through the host image decoder; the
 * generated covers and these glyphs keep the gallery asset-free.)
 */
export function Glyph(props: {
  name: GlyphName;
  size: number;
  color: number;
}): JSX.Element {
  const s = () => props.size;
  const c = () => props.color;
  const bar = (x: number, y: number, w: number, h: number, rotation = 0) => (
    <view x={x} y={y} width={w} height={h} color={c()} rotation={rotation} />
  );
  const dot = (x: number, y: number, d: number) => (
    <view x={x} y={y} width={d} height={d} borderRadius={d / 2} color={c()} />
  );

  const glyph = (): JSX.Element => {
    switch (props.name) {
      case 'library':
        return (
          <>
            {bar(0, s() * 0.18, s() * 0.9, 2)}
            {bar(0, s() * 0.48, s() * 0.9, 2)}
            {bar(0, s() * 0.78, s() * 0.58, 2)}
          </>
        );
      case 'plus':
        return (
          <>
            {bar(s() * 0.5 - 1, s() * 0.1, 2, s() * 0.8)}
            {bar(s() * 0.1, s() * 0.5 - 1, s() * 0.8, 2)}
          </>
        );
      case 'activity':
        return (
          <>
            {bar(s() * 0.08, s() * 0.55, 2, s() * 0.3)}
            {bar(s() * 0.34, s() * 0.2, 2, s() * 0.65)}
            {bar(s() * 0.6, s() * 0.42, 2, s() * 0.43)}
            {bar(s() * 0.86, s() * 0.3, 2, s() * 0.55)}
          </>
        );
      case 'dots':
        return (
          <>
            {dot(s() * 0.1, s() * 0.46, s() * 0.14)}
            {dot(s() * 0.43, s() * 0.46, s() * 0.14)}
            {dot(s() * 0.76, s() * 0.46, s() * 0.14)}
          </>
        );
      case 'search':
        return (
          <>
            <view
              x={s() * 0.06}
              y={s() * 0.06}
              width={s() * 0.6}
              height={s() * 0.6}
              borderRadius={s() * 0.3}
              border={{ width: 2, color: c() }}
            />
            {bar(s() * 0.62, s() * 0.62, s() * 0.34, 2, Math.PI / 4)}
          </>
        );
      case 'filter':
        return (
          <>
            {bar(0, s() * 0.2, s() * 0.9, 2)}
            {bar(s() * 0.14, s() * 0.5, s() * 0.62, 2)}
            {bar(s() * 0.28, s() * 0.8, s() * 0.34, 2)}
          </>
        );
      case 'calendar':
        return (
          <>
            <view
              x={s() * 0.08}
              y={s() * 0.16}
              width={s() * 0.84}
              height={s() * 0.74}
              borderRadius={3}
              border={{ width: 2, color: c() }}
            />
            {bar(s() * 0.24, s() * 0.02, 2, s() * 0.24)}
            {bar(s() * 0.7, s() * 0.02, 2, s() * 0.24)}
          </>
        );
      case 'play':
        return (
          <>
            {bar(s() * 0.2, s() * 0.1, s() * 0.52, 2, 0.9)}
            {bar(s() * 0.2, s() * 0.9, s() * 0.52, 2, -0.9)}
          </>
        );
      case 'shuffle':
        return (
          <>
            {bar(s() * 0.06, s() * 0.22, s() * 0.82, 2, 0.28)}
            {bar(s() * 0.06, s() * 0.72, s() * 0.82, 2, -0.28)}
          </>
        );
    }
  };
  return (
    <view width={s()} height={s()}>
      {glyph()}
    </view>
  );
}
