import type { CanvasShaderType } from '../../renderers/canvas/CanvasShaderNode.js';
import type { Vec4 } from '../../renderers/webgl/internal/ShaderUtils.js';
import {
  computeBorderGeometry,
  type BorderGeometry,
} from '../borderGeometry.js';
import {
  BorderTemplate,
  type BorderProps,
} from '../templates/BorderTemplate.js';
import { fillBorder } from './utils/render.js';

export interface ComputedBorderValues {
  borderColor: string;
  border: BorderGeometry;
}

// The square Border has no corner radius; never mutated.
const NO_RADIUS: Vec4 = [0, 0, 0, 0];

export const Border: CanvasShaderType<BorderProps, ComputedBorderValues> = {
  props: BorderTemplate.props,
  update(node) {
    const props = this.props!;
    this.computed.borderColor = this.toColorString(props.color);
    this.computed.border = computeBorderGeometry(
      node.w,
      node.h,
      NO_RADIUS,
      props.w as Vec4,
      props.align as number,
      props.gap as number,
    );
  },
  render(ctx, node, renderContext) {
    renderContext();
    const computed = this.computed as ComputedBorderValues;
    const g = computed.border;
    if (g.hasBorder === false) {
      return;
    }
    fillBorder(
      ctx,
      node.globalTransform!.tx,
      node.globalTransform!.ty,
      node.props.w,
      node.props.h,
      g,
      NO_RADIUS,
      NO_RADIUS,
      computed.borderColor,
    );
  },
};
