import type { Vec4 } from '../../../renderers/webgl/internal/ShaderUtils.js';
import type { BorderGeometry } from '../../borderGeometry.js';

export function roundRect(
  ctx: CanvasRenderingContext2D | Path2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: Vec4,
) {
  if (ctx.roundRect !== undefined) {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  const { 0: tl, 1: tr, 2: br, 3: bl } = radius;
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + width - tr, y);
  ctx.ellipse(x + width - tr, y + tr, tr, tr, 0, 1.5 * Math.PI, 2 * Math.PI);
  ctx.lineTo(x + width, y - height - br);
  ctx.ellipse(x + width - br, y + height - br, br, br, 0, 0, 0.5 * Math.PI);
  ctx.lineTo(x + bl, y + height);
  ctx.ellipse(x + bl, y + height - bl, bl, bl, 0, 0.5 * Math.PI, Math.PI);
  ctx.lineTo(x, y + tl);
  ctx.ellipse(x + tl, y + tl, tl, tl, 0, Math.PI, 1.5 * Math.PI);
}

export function roundedRectWithBorder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: Vec4,
  g: BorderGeometry,
  borderColor: string,
  renderContext: () => void,
) {
  //draw node content first
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x, y, width, height, radius);
  ctx.clip();
  renderContext();
  ctx.restore();

  if (g.hasBorder === false) {
    return;
  }
  fillBorder(
    ctx,
    x,
    y,
    width,
    height,
    g,
    g.outerRadius,
    g.innerRadius,
    borderColor,
  );
}

/**
 * Fill the border band of a node: outer box minus inner box, with the given
 * corner radii (zeros for the square Border shader).
 */
export function fillBorder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  g: BorderGeometry,
  outerRadius: Vec4,
  innerRadius: Vec4,
  borderColor: string,
) {
  // Box centre = node centre - uv (see BorderGeometry)
  const cx = x + width * 0.5;
  const cy = y + height * 0.5;
  const outerX = cx - g.outerUvX - g.outerHalfW;
  const outerY = cy - g.outerUvY - g.outerHalfH;
  const outerW = g.outerHalfW * 2;
  const outerH = g.outerHalfH * 2;
  // Path2D.addPath is Chrome 68+, so the outer box is traced into both paths
  const outerPath = new Path2D();
  roundRect(outerPath, outerX, outerY, outerW, outerH, outerRadius);
  const borderPath = new Path2D();
  roundRect(borderPath, outerX, outerY, outerW, outerH, outerRadius);
  roundRect(
    borderPath,
    cx - g.innerUvX - g.innerHalfW,
    cy - g.innerUvY - g.innerHalfH,
    g.innerHalfW * 2,
    g.innerHalfH * 2,
    innerRadius,
  );

  // Border = outer minus inner. evenodd alone is outer XOR inner, which also
  // paints where the inner box pokes out of the outer one (a side without a
  // border pulls the outer edge 1px inside the node), so clip to outer first.
  ctx.save();
  ctx.clip(outerPath);
  ctx.fillStyle = borderColor;
  ctx.fill(borderPath, 'evenodd');
  ctx.restore();
}

export function shadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  projection: Vec4,
  radius: Vec4,
  pixelRatio: number,
) {
  ctx.save();
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const scaleFactor = (2 * projection[3] + width) / width;
  ctx.scale(scaleFactor, scaleFactor);
  ctx.shadowColor = color;
  ctx.shadowBlur = projection[2] * pixelRatio;
  ctx.shadowOffsetX = projection[0] + cw * pixelRatio - projection[3] * 0.5;
  ctx.shadowOffsetY = projection[1] + ch * pixelRatio - projection[3] * 0.5;

  const spreadFactor = projection[3];
  ctx.beginPath();
  roundRect(
    ctx,
    (x - spreadFactor - cw) / scaleFactor,
    (y - spreadFactor - ch) / scaleFactor,
    width + spreadFactor,
    height + spreadFactor,
    radius,
  );
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

export function strokeLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  x2: number,
  y2: number,
  lineWidth: number,
) {
  ctx.beginPath();
  ctx.lineWidth = lineWidth;
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
