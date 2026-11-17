import { getNormalizedRgbaComponents } from '../../lib/utils.js';
import { RadialGradientTemplate, } from '../templates/RadialGradientTemplate.js';
import { genGradientColors, gradientStopRamps, } from '../../renderers/webgl/internal/ShaderUtils.js';
import { defaultVertex } from './Default.js';
export const RadialGradient = {
    props: RadialGradientTemplate.props,
    update(node) {
        const props = this.props;
        this.uniform2f('u_projection', props.pivot[0] * node.w, props.pivot[1] * node.h);
        this.uniform2f('u_size', props.w, props.h);
        this.uniform2fv('u_stopRamps', gradientStopRamps(props.stops));
        const colors = [];
        for (let i = 0; i < props.colors.length; i++) {
            const norm = getNormalizedRgbaComponents(props.colors[i]);
            colors.push(norm[0], norm[1], norm[2], norm[3]);
        }
        this.uniform4fv('u_colors', new Float32Array(colors));
    },
    // (point - centre) / size is linear across the quad: interpolate it and
    // the fragment only takes its length.
    vertex: defaultVertex(`    uniform vec2 u_dimensions;
    uniform vec2 u_projection;
    uniform vec2 u_size;
    varying vec2 v_gradient;`, `      v_gradient = (a_nodeCoords * u_dimensions - u_projection) / u_size;`),
    getCacheMarkers(props) {
        return `colors:${props.colors.length}`;
    },
    fragment(renderer, props) {
        return `
      # ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
      # else
      precision mediump float;
      # endif

      #define MAX_STOPS ${props.colors.length}

      uniform float u_alpha;

      uniform sampler2D u_texture;

      uniform vec2 u_stopRamps[MAX_STOPS];
      uniform vec4 u_colors[MAX_STOPS];

      varying vec4 v_color;
      varying vec2 v_textureCoords;
      varying vec2 v_gradient;

      vec4 getGradientColor(float dist) {
        dist = clamp(dist, 0.0, 1.0);
        ${genGradientColors(props.colors.length)}
        return colorOut;
      }

      void main() {
        vec4 color = texture2D(u_texture, v_textureCoords) * v_color;
        float dist = length(v_gradient);

        vec4 colorOut = getGradientColor(dist);
        color = mix(color, colorOut, clamp(colorOut.a, 0.0, 1.0));
        gl_FragColor = color * u_alpha;
      }
    `;
    },
};
//# sourceMappingURL=RadialGradient.js.map