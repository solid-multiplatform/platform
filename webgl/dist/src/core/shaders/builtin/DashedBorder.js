import { PRECISION, defaultVertex, edgeWidthDefine, paramsGlsl, rgbaRow, } from '../glsl.js';
/**
 * The rows both stages read, by name (CLAUDE.md: constant-index defines).
 * U_NODE: half size (xy), corner radius, border width. U_LINE: the
 * centreline's half straight sides (xy) and its corner radius. U_DASH: the
 * dash period, half the dash length, half the period. U_PHASE: the dash
 * pattern's phase at the centre of the top, right, bottom and left sides.
 * U_COLOR: the border colour.
 */
const ROWS = paramsGlsl(['U_NODE', 'U_LINE', 'U_DASH', 'U_PHASE', 'U_COLOR']);
/** `x` modulo `m`, in [0, m). */
const wrap = (x, m) => ((x % m) + m) % m;
/**
 * The node's fill clipped to a rounded rectangle, with a dashed border
 * inside its edge. The dashes follow the border's centreline, corners
 * included, and the dash period is stretched so that a whole number of
 * dashes fits the perimeter: the pattern has no seam where it starts. A
 * transparent node draws only the dashes. A `gap` of 0 or less draws a
 * solid border, a `dash` of 0 or less none.
 *
 * The distance along the centreline is branchless (CLAUDE.md: no `if` on
 * anything that varies per fragment): the point folds into the top-right
 * quadrant, where one clamp per side and one `atan` for the corner give
 * the distance from the centre of the nearest side. Pack works out the
 * pattern's phase at each side's centre, so the shader never holds a
 * distance longer than half a side and a corner: in binary16 (mediump on
 * Mali-400) a distance around the whole perimeter steps by a pixel past
 * 1024 px and by 4 past 4096, coarser than the one-pixel dash edge.
 */
export const DashedBorder = {
    props: {
        radius: 0,
        width: 2,
        // A colour: animations blend it per channel.
        color: { default: 0xffffffff, color: true },
        dash: 10,
        gap: 10,
    },
    vertex: (ctx) => defaultVertex(ctx.viewport, ROWS + 'varying vec2 v_p;', 'v_p=(a_nodeCoords*2.0-1.0)*U_NODE.xy;'),
    fragment: (ctx) => PRECISION +
        '#define HALF_PI 1.5707963\n' +
        edgeWidthDefine(ctx.pixelRatio) +
        'uniform float u_alpha;uniform sampler2D u_texture;\n' +
        ROWS +
        'varying vec4 v_color;varying vec2 v_textureCoords;varying vec2 v_p;\n' +
        'float sdRoundedBox(vec2 p,vec2 halfSize,float r){' +
        'vec2 q=abs(p)-halfSize+r;' +
        'return min(max(q.x,q.y),0.0)+length(max(q,vec2(0.0)))-r;}\n' +
        'void main(){vec4 base=texture2D(u_texture,v_textureCoords)*v_color;' +
        'vec2 p=v_p;' +
        'float dist=sdRoundedBox(p,U_NODE.xy,U_NODE.z);' +
        'float shape=clamp(0.5-dist*INV_EDGE_WIDTH,0.0,1.0);' +
        'float band=shape*clamp((dist+U_NODE.w)*INV_EDGE_WIDTH+0.5,0.0,1.0);' +
        // In the top-right quadrant, `top` picks the nearest side as the
        // corner's diagonal does, so a side's pass is measured along it only
        // (the other axis adds nothing, which keeps the dash edges square
        // across the band). `turn` is the angle into the corner from its top
        // end, a quarter turn on the right side below it. Without a corner
        // radius every arc is 0 long: the branch, on a uniform, skips the
        // atan. The epsilon keeps atan off (0, 0).
        'vec2 a=abs(p);vec2 v=a-U_LINE.xy;' +
        'float top=step(v.x,v.y);float turn=0.0;' +
        'if(U_LINE.z>0.0){float side=(1.0-top)*(1.0-step(0.0,v.y));' +
        'turn=mix(atan(max(v.x,0.0),max(v.y,0.0)+0.0001),HALF_PI,side);}' +
        // The distance from the centre of the nearest side: the top's runs out
        // along x and into the corner, the right's up along y and into it.
        'float l=mix(clamp(a.y,0.0,U_LINE.y)+(HALF_PI-turn)*U_LINE.z,' +
        'clamp(a.x,0.0,U_LINE.x)+turn*U_LINE.z,top);' +
        // Back to the node's quadrant: the phase at that side's centre, and the
        // direction that runs clockwise (+x on the top, +y on the right, -x on
        // the bottom, -y on the left).
        'float bottom=step(0.0,p.y);float right=step(0.0,p.x);' +
        'float phase=mix(mix(U_PHASE.w,U_PHASE.y,right),mix(U_PHASE.x,U_PHASE.z,bottom),top);' +
        'float dir=(1.0-2.0*bottom)*(2.0*right-1.0)*(2.0*top-1.0);' +
        // Centred on each dash: the coverage is symmetric at both ends.
        'float c=mod(phase+dir*l,U_DASH.x)-U_DASH.z;' +
        'float dash=clamp((U_DASH.y-abs(c))*INV_EDGE_WIDTH+0.5,0.0,1.0);' +
        // The border colour is premultiplied here, over the clipped fill.
        'float la=clamp(band*dash*U_COLOR.a*u_alpha,0.0,1.0);' +
        'gl_FragColor=vec4(base.rgb*shape*(1.0-la)+U_COLOR.rgb*la,base.a*shape*(1.0-la)+la);}',
    pack(props, w, h, u) {
        const halfW = w * 0.5;
        const halfH = h * 0.5;
        const radius = Math.min(props.radius, halfW, halfH);
        const halfWidth = props.width * 0.5;
        // The centreline, halfWidth inside the edge.
        const lineRadius = Math.max(radius - halfWidth, 0);
        const straightX = Math.max(halfW - halfWidth - lineRadius, 0);
        const straightY = Math.max(halfH - halfWidth - lineRadius, 0);
        const quarter = straightX + straightY + lineRadius * Math.PI * 0.5;
        const perimeter = 4 * quarter;
        const dashLength = props.dash;
        const gap = props.gap;
        // Past a coverage of 0 or 1 by the edge width: a solid border, or none.
        const edge = 1 / u.pixelRatio;
        let period = 1;
        let halfDash = -edge;
        if (perimeter > 0 && dashLength > 0) {
            if (gap > 0) {
                // Whole dashes only: the pair is stretched to fit the perimeter.
                const pair = dashLength + gap;
                period = perimeter / Math.max(1, Math.round(perimeter / pair));
                halfDash = ((period * dashLength) / pair) * 0.5;
            }
            else {
                halfDash = 0.5 + edge;
            }
        }
        const halfPeriod = period * 0.5;
        // The first dash starts at the left end of the top side; the pattern
        // runs clockwise from there, the top side's centre straightX on.
        const start = straightX + halfPeriod - halfDash;
        u.row(0, halfW, halfH, radius, props.width);
        u.row(1, straightX, straightY, lineRadius, 0);
        u.row(2, period, halfDash, halfPeriod, 0);
        u.row(3, wrap(start, period), wrap(start + quarter, period), wrap(start + 2 * quarter, period), wrap(start + 3 * quarter, period));
        rgbaRow(u, 4, props.color);
    },
};
//# sourceMappingURL=DashedBorder.js.map