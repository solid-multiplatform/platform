import { rampScale } from '../../../shaders/utils.js';
//#endregion Types
export function createShader(glw, type, source) {
    const shader = glw.createShader(type);
    if (!shader) {
        const glError = glw.getError();
        throw new Error(`Unable to create the shader: ${type === glw.VERTEX_SHADER ? 'VERTEX_SHADER' : 'FRAGMENT_SHADER'}.${glError ? ` WebGlContext Error: ${glError}` : ''}`);
    }
    glw.shaderSource(shader, source);
    glw.compileShader(shader);
    const success = !!glw.getShaderParameter(shader, glw.COMPILE_STATUS);
    if (success) {
        return shader;
    }
    console.error(glw.getShaderInfoLog(shader));
    glw.deleteShader(shader);
}
export function createProgram(glw, vertexShader, fragmentShader) {
    const program = glw.createProgram();
    if (!program) {
        throw new Error('Unable to create program');
    }
    glw.attachShader(program, vertexShader);
    glw.attachShader(program, fragmentShader);
    glw.linkProgram(program);
    const success = !!glw.getProgramParameter(program, glw.LINK_STATUS);
    if (success) {
        return program;
    }
    const infoLog = glw.getProgramInfoLog(program) || 'Unknown program link error';
    console.warn(infoLog);
    glw.deleteProgram(program);
    throw new Error(`Unable to link shader program: ${infoLog}`);
}
/**
 * Generates branchless gradient-stop evaluation statements for a fragment
 * shader. Expects a `float dist` in scope and `u_colors` (vec4) and
 * `u_stopRamps` (vec2, filled by {@link gradientStopRamps}) uniform arrays of
 * length `stops`; leaves the result in `vec4 colorOut`.
 *
 * Segment i is `smoothstep(stop[i - 1], stop[i], dist)` with its reciprocal
 * span precomputed: `t = clamp((dist - edge) * scale)` is a subtract and a
 * multiply where smoothstep with uniform edges costs two subtracts and a
 * division. Subtracting first matters on Mali-400, whose mediump is binary16
 * with no fused multiply-add: near the segment the difference is exact, while
 * `dist * scale + offset` rounds the large product before the offset cancels
 * it (about 10/255 off on a 0.9 -> 0.91 segment, against under 4/255 here).
 *
 * The accumulated `mix()` chain is exactly equivalent to selecting the
 * segment containing `dist` (for ascending stops): below a segment the
 * smoothstep is 0 (no-op), above it is 1 (fully replaced by the next color).
 * No `if`/ternary — Mali 400-class fragment pipelines serialize any branch.
 */
export function genGradientColors(stops) {
    let result = `vec4 colorOut = u_colors[0];`;
    for (let i = 1; i < stops; i++) {
        result += `
      float t${i} = clamp((dist - u_stopRamps[${i}].x) * u_stopRamps[${i}].y, 0.0, 1.0);
      colorOut = mix(colorOut, u_colors[${i}], t${i} * t${i} * (3.0 - 2.0 * t${i}));`;
    }
    return result;
}
/**
 * `u_stopRamps` data for {@link genGradientColors}: vec2 i holds the start
 * edge and scale of segment `stops[i - 1]` -> `stops[i]` (see `rampScale`);
 * vec2 0 is unused, keeping the indices aligned with `u_colors`.
 */
export const gradientStopRamps = (stops) => {
    const ramps = new Float32Array(stops.length * 2);
    for (let i = 1; i < stops.length; i++) {
        const e0 = stops[i - 1];
        ramps[i * 2] = e0;
        ramps[i * 2 + 1] = rampScale(e0, stops[i]);
    }
    return ramps;
};
//# sourceMappingURL=ShaderUtils.js.map