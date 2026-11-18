import { PRECISION, defaultVertex, edgeWidthDefine, rgbaRow } from '../glsl.js';
import type { AdvancedProp, ShaderType } from '../ShaderType.js';
import {
  colorsProp,
  gradientGlsl,
  gradientRows,
  packGradient,
  paramsUniform,
  stopsProp,
} from './gradient.js';

export interface RadialProgressProps {
  /** Stroke width in px. */
  width: number;
  /** Outer radius in px; 0 fits the node. */
  radius: number;
  /** Filled portion, in [0, 1]. */
  progress: number;
  /** Where the arc starts, in radians (-PI / 2 is 12 o'clock). */
  startAngle: number;
  /** 1 clockwise, -1 counter-clockwise. */
  direction: 1 | -1;
  /**
   * 0xRRGGBBAA colours along the arc, at most 7: 8 take 18 fragment uniform
   * vectors, past the 16 of the GPU floor (7 take 15 rows, and u_alpha and
   * u_time share the 16th; the rules test holds the count).
   */
  colors: number[];
  stops: number[];
  /** The ring under the arc; 0x00000000 draws none. */
  trackColor: number;
  /** End caps: 0 butt, 1 round. */
  cap: 0 | 1;
  /** Above 0, the shader animates one cycle every `duration` ms, looping. */
  duration: number;
  /** While animating: 0 fills, 1 drains. */
  countdown: 0 | 1;
}

const clampedProp = (def: number, max: number): AdvancedProp<unknown> => ({
  default: def,
  resolve(value) {
    if (value === undefined) {
      return def;
    }
    const v = value as number;
    return v < 0 ? 0 : v > max ? max : v;
  },
});

/**
 * The rows both stages read, by name (CLAUDE.md: constant-index defines);
 * the stops follow from row 5, read by gradientGlsl. Without a duration
 * the arc is static and its quad constants come packed: the end cap's
 * centre, the progress, the cap gate and the gradient's scale. With one,
 * the fragment derives them from u_time, the progress (TIMED).
 */
const ROWS =
  '#define U_CENTRE u_params[0]\n' + // half size (xy: the centre), start cap (zw)
  '#define U_ARC u_params[1]\n' + // radius, half width, start angle, direction
  '#define U_EDGES u_params[2]\n' + // inner and outer edge (xy), end cap (zw, static)
  '#define U_ANIM u_params[3]\n' + // progress, cap gate, gradient scale (static)
  '#define U_TRACK u_params[4]\n'; // track colour

/** Whether `duration` animates the arc: its program derives the progress per op. */
const timed = (props: RadialProgressProps): boolean => props.duration >= 0.0001;

/**
 * A ring or arc with a gradient along it (1.10 RadialProgress). With a
 * `duration` it drives its progress from u_time, the progress in the cycle
 * in [0, 1] with `countdown` applied (the stage clock in ms would overflow
 * binary16 on Mali-400 after a minute). Its edges and caps take the
 * one-device-pixel linear edge of the other built-ins (1.10: a smoothstep
 * two logical px wide). Rows (ROWS): U_CENTRE, U_ARC, U_EDGES, U_ANIM,
 * U_TRACK, then the stops. One program per colour count, cap, track and
 * whether a duration animates it.
 */
export const RadialProgress: ShaderType<RadialProgressProps> = {
  props: {
    width: 8,
    radius: 0,
    progress: clampedProp(1, 1),
    startAngle: -Math.PI / 2,
    direction: 1,
    colors: colorsProp([0xffffffff]),
    stops: stopsProp([0]),
    // 'Color', not 'color': flagged so animations blend it per channel.
    trackColor: { default: 0x00000000, color: true },
    cap: 1,
    duration: clampedProp(0, Infinity),
    countdown: 1,
  } as ShaderType<RadialProgressProps>['props'],
  variant: (props) =>
    `${props.colors.length}|${props.cap}|${props.trackColor !== 0 ? 1 : 0}|${
      timed(props) === true ? 1 : 0
    }`,
  // The discrete inputs of the variant: a write that changes one switches
  // the program.
  variantProps: ['colors', 'cap', 'trackColor', 'duration'],
  time(renderer, props) {
    const duration = props.duration;
    // Without a duration the ring is static: it asks for no frame.
    if (duration < 0.0001) {
      return null;
    }
    const position = (renderer.elapsedTime % duration) / duration;
    return props.countdown >= 0.5 ? 1 - position : position;
  },
  vertex: (ctx, props) =>
    defaultVertex(
      ctx.viewport,
      paramsUniform(5 + gradientRows(props.colors.length)) +
        '\n' +
        ROWS +
        'varying vec2 v_p;',
      'v_p=(a_nodeCoords*2.0-1.0)*U_CENTRE.xy;',
    ),
  fragment: (ctx, props) => {
    const n = props.colors.length;
    const animated = timed(props);
    return (
      PRECISION +
      `#define CAP_ROUND ${props.cap}\n` +
      `#define HAS_TRACK ${props.trackColor !== 0 ? 1 : 0}\n` +
      '#define TWO_PI 6.28318530717958647692\n' +
      edgeWidthDefine(ctx.pixelRatio, ctx.resizable) +
      // A static arc names no u_time: a uniform its program never reads
      // would still split its ops in the headless host (roadmap risks).
      (animated === true
        ? 'uniform float u_alpha;uniform float u_time;uniform sampler2D u_texture;'
        : 'uniform float u_alpha;uniform sampler2D u_texture;') +
      paramsUniform(5 + gradientRows(n)) +
      '\n' +
      ROWS +
      'varying vec4 v_color;varying vec2 v_textureCoords;varying vec2 v_p;\n' +
      // A disc of the stroke's half width, its edge one device pixel wide.
      'float discCoverage(vec2 p,vec2 c){return clamp((U_ARC.y-length(p-c))*INV_EDGE_WIDTH+0.5,0.0,1.0);}\n' +
      'void main(){vec4 base=texture2D(u_texture,v_textureCoords)*v_color;' +
      (animated === true
        ? 'float progress=u_time;' +
          // 0.0001 at both ends: binary16 (mediump on Mali-400) rounds
          // 0.9999 to 1.0, which turned the caps on at progress 1 (1.10's
          // literals), and 0.000001 is below its normal range.
          'float capGate=step(0.0001,progress)*step(0.0001,1.0-progress);' +
          'float hasProgress=step(0.0001,progress);' +
          'float gradScale=hasProgress/mix(1.0,progress,hasProgress);'
        : 'float progress=U_ANIM.x;float capGate=U_ANIM.y;float gradScale=U_ANIM.z;') +
      'vec2 p=v_p;float dist=length(p);' +
      // Each ring edge as (x - edge) * scale: the subtraction is exact on
      // binary16 near the edge, where a multiply-add is not.
      'vec2 ring=clamp(vec2(dist-U_EDGES.x,U_EDGES.y-dist)*INV_EDGE_WIDTH+0.5,0.0,1.0);' +
      'float ringCoverage=ring.x*ring.y;' +
      'float ang=atan(p.y,p.x);float t=mod((ang-U_ARC.z)*U_ARC.w,TWO_PI)/TWO_PI;' +
      'float arcCoverage=max(step(1.0,progress),step(t,progress));' +
      'float fillCoverage=ringCoverage*arcCoverage;\n' +
      '#if CAP_ROUND\n' +
      (animated === true
        ? 'float a1=U_ARC.z+U_ARC.w*progress*TWO_PI;vec2 cap1=vec2(cos(a1),sin(a1))*U_ARC.x;'
        : 'vec2 cap1=U_EDGES.zw;') +
      'float capMask=max(discCoverage(p,U_CENTRE.zw),discCoverage(p,cap1));' +
      'fillCoverage=max(fillCoverage,capMask*capGate);\n' +
      '#endif\n' +
      'float gradT=clamp(t*gradScale,0.0,1.0);' +
      gradientGlsl(n, 5, 'gradT') +
      'vec4 fillPM=vec4(colorOut.rgb*colorOut.a,colorOut.a);vec4 layer=vec4(0.0);\n' +
      '#if HAS_TRACK\n' +
      'vec4 trackPM=vec4(U_TRACK.rgb*U_TRACK.a,U_TRACK.a);' +
      'float trackCoverage=ringCoverage*(1.0-fillCoverage);' +
      'layer=trackPM*trackCoverage+fillPM*fillCoverage;\n' +
      '#else\nlayer=fillPM*fillCoverage;\n#endif\n' +
      'layer*=u_alpha;float la=clamp(layer.a,0.0,1.0);' +
      'vec3 blended=base.rgb*(1.0-la)+layer.rgb;float outA=base.a+la*(1.0-base.a);' +
      'gl_FragColor=vec4(blended,outA);}'
    );
  },
  pack(props, w, h, u) {
    const autoRadius = Math.min(w, h) * 0.5 - props.width * 0.5;
    const radius = props.radius > 0 ? props.radius : autoRadius;
    const halfW = props.width * 0.5;
    const startAngle = props.startAngle;
    const progress = props.progress;
    const end = startAngle + props.direction * progress * Math.PI * 2;
    // The static arc's gates, as the shader's step() would take them.
    const hasProgress = progress >= 0.0001 ? 1 : 0;
    const capGate = hasProgress === 1 && 1 - progress >= 0.0001 ? 1 : 0;
    // Rows 0 to 4: U_CENTRE, U_ARC, U_EDGES, U_ANIM, U_TRACK (ROWS).
    u.row(
      0,
      w * 0.5,
      h * 0.5,
      Math.cos(startAngle) * radius,
      Math.sin(startAngle) * radius,
    );
    u.row(1, radius, halfW, startAngle, props.direction);
    u.row(
      2,
      radius - halfW,
      radius + halfW,
      Math.cos(end) * radius,
      Math.sin(end) * radius,
    );
    u.row(3, progress, capGate, hasProgress === 1 ? 1 / progress : 0, 0);
    rgbaRow(u, 4, props.trackColor);
    packGradient(u, 5, props.colors, props.stops);
  },
};
