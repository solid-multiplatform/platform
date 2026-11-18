/**
 * What a node's colours and shader props ask this backend to draw, and how
 * each tier draws it. Nothing here touches SceneGraph: `planDecor` turns the
 * inputs into plain data (an Effect node's fields, overlay images, a shadow)
 * that RokuNode writes, so the mapping is testable without a device.
 *
 * The tiers (chosen once per renderer, see detectEffectTier in renderer.ts):
 *
 * - `native`: the Roku OS 16 Effect node on OpenGL. Rounded corners, a
 *   uniform border and linear/radial gradients are Effect fields.
 * - `assets`: no Effect node. Corners are square; gradients are white alpha
 *   ramps tinted with blendColor; borders are plain rectangles.
 *
 * Both tiers draw four-corner colours with weight images and the shadow with
 * a pre-blurred 9-patch (the Effect node has no shadow). Whatever a tier
 * cannot draw is reported once through `reportGap`, never dropped silently.
 */
import { ASSETS, shadowAsset } from './assets.js';

export type EffectTier = 'native' | 'assets';
export type Vec4 = [number, number, number, number];

export function toRokuColor(value: any, fallback = '0x00000000'): string {
  if (typeof value === 'string') {
    if (value.startsWith('0x') || value.startsWith('0X')) return value;
    if (value.startsWith('#')) {
      let hex = value.slice(1);
      // CSS shorthand: #rgb and #rgba. Expanding here keeps every caller
      // (color, colorTop, src-as-color) consistent.
      if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('') + 'ff';
      else if (hex.length === 4) hex = hex.split('').map((c) => c + c).join('');
      else hex = hex.padEnd(8, 'f');
      return '0x' + hex.toUpperCase();
    }
    return fallback;
  }
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'function') {
    try { return toRokuColor(value(), fallback); } catch (e) { /* fall through */ }
  }
  let n = Number(value);
  if (!Number.isFinite(n) && typeof value === 'object') {
    // Some renderer styles hand us a colour wrapper rather than a uint32.
    // Solid proxies can also be cyclic, so never JSON-serialise here.
    for (const key of ['value', 'color', 'argb', 'rgba', 'get']) {
      const v = value[key];
      if (typeof v === 'function') {
        try {
          const out = v.call(value);
          if (out !== undefined && out !== value) return toRokuColor(out, fallback);
        } catch (e) { /* ignore */ }
      } else if (typeof v === 'string') {
        return toRokuColor(v, fallback);
      } else if (typeof v === 'number' && Number.isFinite(v)) {
        n = v;
        break;
      }
    }
    if (!Number.isFinite(n)) {
      const r = Number(value.r), g = Number(value.g), b = Number(value.b), a = Number(value.a);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        const scale = r <= 1 && g <= 1 && b <= 1 ? 255 : 1;
        const alpha = Number.isFinite(a) ? (a <= 1 ? a * 255 : a) : 255;
        n = (((r * scale) & 255) << 24) | (((g * scale) & 255) << 16) | (((b * scale) & 255) << 8) | (alpha & 255);
      }
    }
    if (!Number.isFinite(n)) {
      // Solid style objects can wrap a string/number. String() unwraps a
      // primitive proxy without walking its (possibly cyclic) structure.
      try {
        const text = String(value);
        if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text) || /^0x[0-9a-fA-F]+$/.test(text)) {
          return toRokuColor(text, fallback);
        }
        if (/^\d+$/.test(text)) n = Number(text);
      } catch (e) { /* fall through */ }
    }
  }
  if (!Number.isFinite(n)) return fallback;
  return '0x' + (n >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

const reported = new Set<string>();
/** Report something a tier cannot draw. Warns once per message. */
export function reportGap(message: string) {
  if (reported.has(message)) return;
  reported.add(message);
  console.warn('ROKU_EFFECT_GAP ' + message);
}
/** Every gap reported so far, for a capability report. */
export function effectGaps(): string[] {
  return Array.from(reported);
}

const finite = (value: any, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** A colour in any form the platform passes, as 0xRRGGBBAA. */
export function colorNumber(value: any, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0;
  if (value === undefined || value === null) return fallback >>> 0;
  const text = toRokuColor(value, '');
  return text ? parseInt(text.slice(2), 16) >>> 0 : fallback >>> 0;
}

const hex = (n: number) => '0x' + (n >>> 0).toString(16).padStart(8, '0').toUpperCase();

/** `over` drawn on `under` by its alpha, as the gradient shaders mix. */
function mixOver(under: number, over: number): number {
  const a = (over & 255) / 255;
  if (a >= 1 || (under & 255) === 0) return over >>> 0;
  let out = 0;
  for (let shift = 24; shift >= 0; shift -= 8) {
    const u = (under >>> shift) & 255;
    const o = shift === 0 ? 255 : (over >>> shift) & 255;
    out = (out | (Math.round(u + (o - u) * a) << shift)) >>> 0;
  }
  return out;
}

/** A number, or an array of 1 to 4, as four values (the WebGL backend's rule). */
export function toVec4(value: any): Vec4 {
  if (!Array.isArray(value)) {
    const v = finite(value, 0);
    return [v, v, v, v];
  }
  const a = value.map((v) => finite(v, 0));
  if (a.length >= 4) return [a[0], a[1], a[2], a[3]];
  if (a.length === 3) return [a[0], a[1], a[2], a[0]];
  if (a.length === 2) return [a[0], a[1], a[0], a[1]];
  const v = a.length ? a[0] : 0;
  return [v, v, v, v];
}

/**
 * Corner radii scaled down so that adjacent corners never overlap, as the
 * WebGL backend does. The Effect node does not: a radius past half the box
 * draws a lens.
 */
export function factorRadius(radius: Vec4, w: number, h: number): Vec4 {
  const r = radius.map((v) => Math.max(0, v));
  const factor = Math.min(
    w / Math.max(w, r[0] + r[1]),
    w / Math.max(w, r[2] + r[3]),
    h / Math.max(h, r[0] + r[3]),
    h / Math.max(h, r[1] + r[2]),
    1,
  );
  const f = Number.isFinite(factor) ? factor : 0;
  return [r[0] * f, r[1] * f, r[2] * f, r[3] * f];
}

// ---- what the shader props ask for --------------------------------------

export interface BorderStyle {
  /** [top, right, bottom, left] */
  widths: Vec4;
  color: number;
  /** 0 inside the node, 1 outside (the default), as on WebGL. */
  align: number;
  gap: number;
}
export interface ShadowStyle {
  color: number;
  x: number;
  y: number;
  blur: number;
  spread: number;
}
export interface GradientStyle {
  radial: boolean;
  colors: number[];
  stops: number[];
  /** Linear: radians, 0 top to bottom, PI/2 right to left. */
  angle: number;
  /** Radial: the centre as a fraction of the node, and the radii in pixels. */
  pivot: [number, number];
  rw: number;
  rh: number;
}
export interface EffectStyle {
  radius: Vec4 | null;
  border: BorderStyle | null;
  shadow: ShadowStyle | null;
  gradient: GradientStyle | null;
}

const SIDES = ['border-top', 'border-right', 'border-bottom', 'border-left'];

function readBorder(props: any): BorderStyle | null {
  const widths = toVec4(props['border-w'] ?? 0);
  for (let i = 0; i < 4; i++) {
    if (props[SIDES[i]] !== undefined) widths[i] = finite(props[SIDES[i]], 0);
    if (!(widths[i] > 0)) widths[i] = 0;
  }
  if (widths[0] + widths[1] + widths[2] + widths[3] <= 0) return null;
  const a = props['border-align'];
  const align = a === 'inside' ? 0 : a === 'center' ? 0.5 : typeof a === 'number' && Number.isFinite(a) ? a : 1;
  return {
    widths,
    color: colorNumber(props['border-color'], 0xffffffff),
    align,
    gap: Math.max(0, finite(props['border-gap'], 0)),
  };
}

function readShadow(name: string, props: any): ShadowStyle | null {
  const given =
    props.shadow != null ||
    props['shadow-color'] !== undefined ||
    props['shadow-projection'] !== undefined ||
    /shadow/i.test(name);
  if (!given) return null;
  // [x, y, blur, spread], with the WebGL backend's defaults.
  const p = props['shadow-projection'] !== undefined ? toVec4(props['shadow-projection']) : ([0, 0, 5, 5] as Vec4);
  const color = colorNumber(props['shadow-color'], 0x000000ff);
  if ((color & 255) === 0) return null;
  return {
    color,
    x: finite(props['shadow-x'], p[0]),
    y: finite(props['shadow-y'], p[1]),
    blur: Math.max(0, finite(props['shadow-blur'], p[2])),
    spread: finite(props['shadow-spread'], p[3]),
  };
}

function readGradient(name: string, props: any): GradientStyle | null {
  const radial = name === 'radialGradient';
  if (!radial && name !== 'linearGradient') return null;
  const raw = Array.isArray(props.colors) ? props.colors : [0x000000ff, 0xffffffff];
  if (raw.length < 2) return null;
  const colors: number[] = raw.map((c: any) => colorNumber(c, 0));
  let stops: number[] = Array.isArray(props.stops) ? props.stops.map((s: any) => finite(s, 0)) : [];
  if (stops.length !== colors.length) stops = colors.map((_, i) => i / (colors.length - 1));
  stops = stops.map((s) => Math.max(0, Math.min(1, s)));
  const pivot: [number, number] = Array.isArray(props.pivot)
    ? [finite(props.pivot[0], 0.5), finite(props.pivot[1], 0.5)]
    : [0.5, 0.5];
  return { radial, colors, stops, angle: finite(props.angle, 0), pivot, rw: finite(props.w, 50), rh: finite(props.h, 50) };
}

/** The effects a shader's kind and flat props describe. */
export function readStyle(name: string, props: any): EffectStyle {
  const p = props || {};
  if (name === 'holePunch' || name === 'radialProgress') reportGap(name + ' has no SceneGraph equivalent');
  const radius = p.radius !== undefined && p.radius !== null ? toVec4(p.radius) : null;
  return {
    radius: radius && radius.some((r) => r > 0) ? radius : null,
    border: readBorder(p),
    shadow: readShadow(name, p),
    gradient: readGradient(name, p),
  };
}

// ---- the Effect node's fields -------------------------------------------

/** The fields of one Effect node. `key` names the values: equal keys share a node. */
export interface NativeEffect {
  key: string;
  borderRadius: number | number[];
  borderWidth: number;
  borderColor: string;
  borderPadding: number;
  gradientStyle: 'none' | 'linear' | 'radial';
  gradientColors: string[];
  gradientStops: number[];
  gradientAngle: number;
  gradientCentre: number[];
  gradientRadius: number[];
}

interface NativeGradient {
  style: 'linear' | 'radial';
  colors: number[];
  stops: number[];
  angle: number;
  centre: number[];
  radius: number[];
}

const MAX_COLORS = 8;
const round = (v: number, places: number) => Math.round(v * places) / places;

/** At most eight colours: the Effect node drops what follows the eighth. */
function capColors(g: { colors: number[]; stops: number[] }) {
  if (g.colors.length <= MAX_COLORS) return g;
  reportGap('a gradient of more than 8 colours keeps 8 of them');
  const colors: number[] = [];
  const stops: number[] = [];
  for (let i = 0; i < MAX_COLORS; i++) {
    const at = Math.round((i * (g.colors.length - 1)) / (MAX_COLORS - 1));
    colors.push(g.colors[at]);
    stops.push(g.stops[at]);
  }
  return { colors, stops };
}

/**
 * The Effect node's angle for the platform's. The platform's angle is in
 * pixels (0: top to bottom, PI/2: right to left). The Effect node's is in
 * degrees, 0 pointing up and 90 right, and it is measured in the node's
 * unit square, so a box that is not square skews it: the angle is corrected
 * by the box's aspect, which makes the two gradients identical.
 */
export function nativeAngle(angle: number, w: number, h: number): number {
  const degrees = (Math.atan2(-Math.sin(angle) * (w || 1), -Math.cos(angle) * (h || 1)) * 180) / Math.PI;
  return round((degrees + 360) % 360, 100);
}

function nativeGradient(g: GradientStyle, w: number, h: number): NativeGradient {
  const { colors, stops } = capColors(g);
  if (g.radial) {
    return {
      style: 'radial',
      colors,
      stops,
      angle: 0,
      centre: [round(g.pivot[0], 10000), round(g.pivot[1], 10000)],
      radius: [w > 0 ? round(g.rw / w, 10000) : 0.5, h > 0 ? round(g.rh / h, 10000) : 0.5],
    };
  }
  return { style: 'linear', colors, stops, angle: nativeAngle(g.angle, w, h), centre: [0.5, 0.5], radius: [0.5, 0.5] };
}

function nativeEffect(
  radius: Vec4 | null,
  border: { width: number; color: number; padding: number } | null,
  gradient: NativeGradient | null,
): NativeEffect | null {
  if (!radius && !border && !gradient) return null;
  let borderRadius: number | number[] = 0;
  if (radius) {
    const r = radius.map((v) => round(v, 100));
    borderRadius = r[0] === r[1] && r[1] === r[2] && r[2] === r[3] ? r[0] : r;
  }
  const effect: NativeEffect = {
    key: '',
    borderRadius,
    borderWidth: border ? round(border.width, 100) : 0,
    borderColor: border ? hex(border.color) : '0xFFFFFFFF',
    borderPadding: border ? round(border.padding, 100) : 0,
    gradientStyle: gradient ? gradient.style : 'none',
    gradientColors: gradient ? gradient.colors.map(hex) : [],
    gradientStops: gradient ? gradient.stops.map((s) => round(s, 10000)) : [],
    gradientAngle: gradient ? gradient.angle : 0,
    gradientCentre: gradient ? gradient.centre : [0.5, 0.5],
    gradientRadius: gradient ? gradient.radius : [0.5, 0.5],
  };
  effect.key =
    String(effect.borderRadius) + '|' + effect.borderWidth + '|' + effect.borderColor + '|' + effect.borderPadding +
    (gradient
      ? '|' + effect.gradientStyle + '|' + effect.gradientColors.join(',') + '|' + effect.gradientStops.join(',') +
        '|' + effect.gradientAngle + '|' + effect.gradientCentre.join(',') + '|' + effect.gradientRadius.join(',')
      : '');
  return effect;
}

// ---- the plan ------------------------------------------------------------

/** One node drawn above the visual and below the node's children. */
export interface DecorLayer {
  /** An image tinted with `color`, or a rectangle filled with it. */
  uri: string | null;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Takes the plan's `layerEffect` (the corner radius). */
  rounded: boolean;
}

export interface DecorPlan {
  /** The visual's box inside the node, its colour (blend, for an image) and Effect. */
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  effect: NativeEffect | null;
  /** The shadow image, drawn below the visual. */
  shadow: DecorLayer | null;
  layers: DecorLayer[];
  layerEffect: NativeEffect | null;
}

export interface DecorInput {
  tier: EffectTier;
  w: number;
  h: number;
  /** The corner colours the node draws with. */
  tl: number;
  tr: number;
  bl: number;
  br: number;
  /** A Poster draws the node; `blend` tints it. */
  image: boolean;
  blend: number;
  shader: { name: string; props: any } | null;
}

const NO_STYLE: EffectStyle = { radius: null, border: null, shadow: null, gradient: null };
const TRANSPARENT = '0x00000000';
const layer = (uri: string | null, color: number, x: number, y: number, w: number, h: number, rounded = false): DecorLayer => ({
  uri, color: hex(color), x, y, w, h, rounded,
});

/** A linear gradient on the assets tier: ramps and fills along one axis. */
function axisLayers(g: GradientStyle, base: number, w: number, h: number, layers: DecorLayer[]): number {
  const dx = -Math.sin(g.angle);
  const dy = Math.cos(g.angle);
  const horizontal = Math.abs(dx) > Math.abs(dy);
  if (Math.min(Math.abs(dx), Math.abs(dy)) > 0.01) reportGap('a linear gradient angle snaps to an axis without the Effect node');
  let colors = g.colors;
  let stops = g.stops;
  if ((horizontal ? dx : dy) < 0) {
    colors = colors.slice().reverse();
    stops = stops.map((s) => 1 - s).reverse();
  }
  const span = horizontal ? w : h;
  const box = (from: number, to: number): [number, number, number, number] =>
    horizontal ? [from * span, 0, (to - from) * span, h] : [0, from * span, w, (to - from) * span];
  for (let i = 1; i < colors.length; i++) {
    const from = stops[i - 1];
    const to = Math.max(from, stops[i]);
    if (to > from) layers.push(layer(horizontal ? ASSETS.rampH : ASSETS.rampV, colors[i], ...box(from, to)));
    if (to < 1) layers.push(layer(null, colors[i], ...box(to, 1)));
  }
  return mixOver(base, colors[0]);
}

/** How this tier draws a node's colours, shader and shadow. */
export function planDecor(input: DecorInput): DecorPlan {
  const { tier, w, h } = input;
  const native = tier === 'native';
  const style = input.shader ? readStyle(input.shader.name, input.shader.props) : NO_STYLE;
  const layers: DecorLayer[] = [];

  let radius = style.radius ? factorRadius(style.radius, w, h) : null;
  if (radius && !radius.some((r) => r > 0)) radius = null;
  if (radius && !native) {
    reportGap('rounded corners need the Effect node (Roku OS 16 on OpenGL): drawn square');
    radius = null;
  }

  // The border. The Effect node draws one width outside the visual, so an
  // inside or centred border insets the visual instead.
  const border = style.border;
  let inset = 0;
  let effectBorder: { width: number; color: number; padding: number } | null = null;
  let outside = 0; // how far the border reaches past the node, for the shadow
  const edges: DecorLayer[] = [];
  if (border) {
    const [t, r, b, l] = border.widths;
    const uniform = t === r && r === b && b === l;
    const widest = Math.max(t, r, b, l);
    outside = widest * border.align + border.gap;
    if (native && (uniform || radius)) {
      if (!uniform) reportGap('per-side border widths with a corner radius draw the widest on every side');
      inset = widest * (1 - border.align);
      effectBorder = { width: widest, color: border.color, padding: border.gap };
    } else {
      const gap = (width: number) => (width > 0 ? border.gap : 0);
      const left = 0 - (l * border.align + gap(l));
      const top = 0 - (t * border.align + gap(t));
      const right = w + r * border.align + gap(r);
      const bottom = h + b * border.align + gap(b);
      if (t > 0) edges.push(layer(null, border.color, left, top, right - left, t));
      if (b > 0) edges.push(layer(null, border.color, left, bottom - b, right - left, b));
      if (l > 0) edges.push(layer(null, border.color, left, top + t, l, bottom - b - top - t));
      if (r > 0) edges.push(layer(null, border.color, right - r, top + t, r, bottom - b - top - t));
    }
  }
  const x = inset;
  const y = inset;
  const cw = Math.max(0, w - 2 * inset);
  const ch = Math.max(0, h - 2 * inset);
  const contentRadius = radius && inset > 0 ? (radius.map((v) => Math.max(0, v - inset)) as Vec4) : radius;

  // The fill.
  const { tl, tr, bl, br } = input;
  const varies = tl !== tr || tl !== bl || tl !== br;
  let color = input.image ? input.blend : tl;
  let gradient: NativeGradient | null = null;
  let transparentBase = false;
  if (style.gradient) {
    const g = style.gradient;
    if (varies) reportGap('node colours under a gradient shader use the top-left colour');
    if (native) gradient = nativeGradient(g, cw, ch);
    else if (input.image) reportGap('a gradient over an image needs the Effect node');
    else if (!g.radial) color = axisLayers(g, color, w, h, layers);
    else {
      const cx = g.pivot[0] * w;
      const cy = g.pivot[1] * h;
      color = mixOver(color, g.colors[g.colors.length - 1]);
      if (g.colors.length > 2) reportGap('a radial gradient draws its first and last colour without the Effect node');
      if (cx - g.rw < -0.5 || cy - g.rh < -0.5 || cx + g.rw > w + 0.5 || cy + g.rh > h + 0.5)
        reportGap('a radial gradient that reaches past its node needs the Effect node: drawn flat');
      else layers.push(layer(ASSETS.rampRadial, g.colors[0], cx - g.rw, cy - g.rh, 2 * g.rw, 2 * g.rh));
    }
  } else if (input.image) {
    if (varies) reportGap('per-corner colours on an image use one colour');
  } else if (varies) {
    const vertical = tl === tr && bl === br;
    const horizontal = tl === bl && tr === br;
    if (native) {
      // Over a transparent rectangle the gradient is the fill, alpha included.
      transparentBase = true;
      gradient = vertical
        ? { style: 'linear', colors: [tl, bl], stops: [0, 1], angle: 180, centre: [0.5, 0.5], radius: [0.5, 0.5] }
        : { style: 'linear', colors: [tl, tr], stops: [0, 1], angle: 90, centre: [0.5, 0.5], radius: [0.5, 0.5] };
    } else if (vertical) layers.push(layer(ASSETS.rampV, bl, x, y, cw, ch));
    else layers.push(layer(ASSETS.rampH, tr, x, y, cw, ch));
    if (!vertical && !horizontal) {
      // The top row is drawn; the bottom corners go over it by their weights.
      layers.push(layer(ASSETS.weightBl, bl, x, y, cw, ch, !!contentRadius));
      layers.push(layer(ASSETS.weightBr, br, x, y, cw, ch, !!contentRadius));
    }
  }
  for (const edge of edges) layers.push(edge);

  let shadow: DecorLayer | null = null;
  if (style.shadow) {
    const s = style.shadow;
    const grow = s.spread + outside;
    const corner = radius ? Math.max(radius[0], radius[1], radius[2], radius[3]) + outside : 0;
    const asset = shadowAsset(corner, s.blur);
    if (asset.blur !== s.blur || asset.radius !== corner)
      reportGap('a shadow draws with the nearest shipped corner radius and blur');
    const reach = grow + asset.blur;
    shadow = layer(asset.uri, s.color, s.x - reach, s.y - reach, w + 2 * reach, h + 2 * reach);
  }

  return {
    x,
    y,
    w: cw,
    h: ch,
    color: transparentBase ? TRANSPARENT : hex(color),
    effect: native ? nativeEffect(contentRadius, effectBorder, gradient) : null,
    shadow,
    layers,
    layerEffect: native && contentRadius && layers.some((l) => l.rounded) ? nativeEffect(contentRadius, null, null) : null,
  };
}
