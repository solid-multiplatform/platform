import { getNormalizedRgbaComponents } from '../../lib/utils.js';
import { RadialProgressTemplate, } from '../templates/RadialProgressTemplate.js';
import { genGradientColors, gradientStopRamps, } from '../../renderers/webgl/internal/ShaderUtils.js';
import { defaultVertex } from './Default.js';
export const RadialProgress = {
    props: RadialProgressTemplate.props,
    // u_time is the cycle position in [0, 1), computed here in double
    // precision. The stage's millisecond clock would overflow binary16
    // (mediump on Mali-400, max 65504) after about a minute of uptime.
    time(stage, props) {
        const duration = props.duration;
        if (duration < 0.0001) {
            return 0;
        }
        return (stage.elapsedTime % duration) / duration;
    },
    update(node) {
        const props = this.props;
        const autoRadius = Math.min(node.w, node.h) * 0.5 - props.width * 0.5;
        const radius = props.radius > 0 ? props.radius : autoRadius;
        // Everything below is a function of props + size, so it is derived once
        // here rather than on every fragment.
        const halfW = props.width * 0.5;
        const startAngle = props.startAngle;
        // xy: ring centre, zw: start-cap centre relative to it
        this.uniform4f('u_center', node.w * 0.5, node.h * 0.5, Math.cos(startAngle) * radius, Math.sin(startAngle) * radius);
        this.uniform4f('u_arc', radius, halfW, startAngle, props.direction);
        // AA ramps of the ring's inner and outer edges and of the caps (discs of
        // radius halfW): smoothstep(e - 1, e + 1, dist), 1px either side of edge
        // e. The span is always 2, so the shader's t = clamp(dist * 0.5 + offset)
        // only needs offset = (1 - e) / 2, computed here once.
        this.uniform4f('u_ring', (1 - (radius - halfW)) * 0.5, (1 - (radius + halfW)) * 0.5, (1 - halfW) * 0.5, 0);
        // x: unused (the cycle position arrives in u_time), y: 1 when
        // self-animating, z: 1 for countdown, w: static progress
        const animated = props.duration >= 0.0001;
        this.uniform4f('u_anim', 0, animated === true ? 1 : 0, props.countdown >= 0.5 ? 1 : 0, props.progress);
        this.uniform2fv('u_stopRamps', gradientStopRamps(props.stops));
        const colors = [];
        for (let i = 0; i < props.colors.length; i++) {
            const norm = getNormalizedRgbaComponents(props.colors[i]);
            colors.push(norm[0], norm[1], norm[2], norm[3]);
        }
        this.uniform4fv('u_colors', new Float32Array(colors));
        const trackNorm = getNormalizedRgbaComponents(props.trackColor);
        this.uniform4f('u_trackColor', trackNorm[0], trackNorm[1], trackNorm[2], trackNorm[3]);
    },
    // Position relative to the ring centre is linear across the quad
    vertex: defaultVertex(`    uniform vec2 u_dimensions;
    uniform vec4 u_center;
    varying vec2 v_p;`, `      v_p = a_nodeCoords * u_dimensions - u_center.xy;`),
    getCacheMarkers(props) {
        return `colors:${props.colors.length}|cap:${props.cap}|track:${props.trackColor !== 0 ? 1 : 0}`;
    },
    fragment(renderer, props) {
        const maxStops = Math.max(props.colors.length, 1);
        return `
      # ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
      # else
      precision mediump float;
      # endif

      #define MAX_STOPS ${maxStops}
      #define CAP_ROUND ${props.cap}
      #define HAS_TRACK ${props.trackColor !== 0 ? 1 : 0}

      #define TWO_PI 6.28318530717958647692

      uniform float u_alpha;
      uniform float u_time;
      uniform sampler2D u_texture;

      // xy: ring centre, zw: start-cap centre relative to it
      uniform vec4 u_center;
      // x: radius, y: half stroke width, z: start angle, w: direction
      uniform vec4 u_arc;
      // AA ramp offsets -- x: ring inner edge, y: ring outer edge, z: caps.
      // Each is smoothstep(e - 1, e + 1, dist)'s t = clamp(dist * 0.5 + offset)
      uniform vec4 u_ring;
      // x: unused, y: 1 when self-animating, z: 1 for countdown,
      // w: static progress
      uniform vec4 u_anim;

      uniform vec2 u_stopRamps[MAX_STOPS];
      uniform vec4 u_colors[MAX_STOPS];
      uniform vec4 u_trackColor;

      varying vec4 v_color;
      varying vec2 v_textureCoords;
      varying vec2 v_p;

      vec4 getGradientColor(float dist) {
        dist = clamp(dist, 0.0, 1.0);
        ${genGradientColors(maxStops)}
        return colorOut;
      }

      // Coverage of a cap disc (radius: half stroke width) centered at \`c\` at
      // pixel \`p\` (with 1px AA)
      float discCoverage(vec2 p, vec2 c) {
        float t = clamp(length(p - c) * 0.5 + u_ring.z, 0.0, 1.0);
        return 1.0 - t * t * (3.0 - 2.0 * t);
      }

      void main() {
        vec4 base = texture2D(u_texture, v_textureCoords) * v_color;

        // Effective progress: when self-animating (u_anim.y) the shader drives
        // it from u_time, the cycle position in [0, 1) (see the shader type's
        // time function), otherwise it is the static progress prop. countdown
        // drains (1 -> 0), otherwise it fills (0 -> 1).
        float cyclePos = u_time;
        float animProgress = mix(cyclePos, 1.0 - cyclePos, u_anim.z);
        float progress = mix(u_anim.w, animProgress, u_anim.y);

        vec2 p = v_p;
        float dist = length(p);

        // Ring coverage: 1 inside the stroke band, 0 outside (with 1px AA on both edges)
        vec2 ring = clamp(dist * 0.5 + u_ring.xy, 0.0, 1.0);
        ring = ring * ring * (3.0 - 2.0 * ring);
        float ringCoverage = ring.x * (1.0 - ring.y);

        // Angle along the arc, normalized to [0, 1) starting at the start angle
        float ang = atan(p.y, p.x);
        float t = mod((ang - u_arc.z) * u_arc.w, TWO_PI) / TWO_PI;

        // Filled arc coverage (1 if in filled arc, else 0). When progress >= 1 the
        // whole ring is filled regardless of \`t\` -- guards against the mod() seam.
        float arcCoverage = max(step(1.0, progress), step(t, progress));
        float fillCoverage = ringCoverage * arcCoverage;

        #if CAP_ROUND
          // Round caps: discs of radius halfW at the start and head of the arc
          // The start cap is fixed (precomputed); only the head moves
          float a1 = u_arc.z + u_arc.w * progress * TWO_PI;
          vec2 cap0 = u_center.zw;
          vec2 cap1 = vec2(cos(a1), sin(a1)) * u_arc.x;
          float capMask = max(discCoverage(p, cap0), discCoverage(p, cap1));
          // Caps only visible when there's something to cap (progress > 0 and < 1).
          float capGate = step(0.0001, progress) * step(progress, 0.9999);
          fillCoverage = max(fillCoverage, capMask * capGate);
        #endif

        // Sample gradient. Normalize \`t\` to the *filled* portion so the gradient
        // spans the visible arc end-to-end regardless of progress. mix()-guarded
        // denominator: safe at progress == 0 without fp16 overflow.
        float hasProgress = step(0.000001, progress);
        float gradT = clamp(t / mix(1.0, progress, hasProgress), 0.0, 1.0) * hasProgress;
        vec4 fillCol = getGradientColor(gradT);

        // Composite: track under fill (if track enabled), both gated by ringCoverage.
        // We work in PREMULTIPLIED-alpha space here so AA edges composite cleanly
        // against \`base\` -- mix(base.rgb, layer.rgb, la) with a coverage-scaled
        // \`layer\` would multiply layer.rgb by coverage a second time and darken
        // the AA falloff (see issue #36). The renderer's blend func is
        // (ONE, ONE_MINUS_SRC_ALPHA), which expects premultiplied output.
        vec4 fillPM = vec4(fillCol.rgb * fillCol.a, fillCol.a);
        vec4 layer = vec4(0.0);
        #if HAS_TRACK
          vec4 trackPM = vec4(u_trackColor.rgb * u_trackColor.a, u_trackColor.a);
          float trackCoverage = ringCoverage * (1.0 - fillCoverage);
          layer = trackPM * trackCoverage + fillPM * fillCoverage;
        #else
          layer = fillPM * fillCoverage;
        #endif

        // Apply node opacity to the introduced ring/track colors. They come
        // from u_colors / u_trackColor and do not carry worldAlpha, so without
        // this a fading RadialProgress node would keep its ring fully opaque.
        // \`base\` already includes worldAlpha (via v_color), so it is left as-is
        // to avoid double-applying. Scaling a premultiplied layer is valid.
        layer *= u_alpha;

        // Premultiplied "over": out = src + dst*(1 - src.a). The output stays
        // visible on a fully-transparent \`base\` because layer brings its own alpha.
        float la = clamp(layer.a, 0.0, 1.0);
        vec3 blended = base.rgb * (1.0 - la) + layer.rgb;
        float outA = base.a + la * (1.0 - base.a);
        gl_FragColor = vec4(blended, outA);
      }
    `;
    },
};
//# sourceMappingURL=RadialProgress.js.map