import { calcFactoredRadiusArray } from '../../lib/utils.js';
import type { CanvasShaderType } from '../../renderers/canvas/CanvasShaderNode.js';
import type { Vec4 } from '../../renderers/webgl/internal/ShaderUtils.js';
import {
  computeBorderGeometry,
  type BorderGeometry,
} from '../borderGeometry.js';
import {
  RoundedWithBorderTemplate,
  type RoundedWithBorderProps,
} from '../templates/RoundedWithBorderTemplate.js';
import type { ComputedRoundedValues } from './Rounded.js';
import { roundedRectWithBorder } from './utils/render.js';

export type ComputedRoundedWithBorderValues = ComputedRoundedValues & {
  borderColor: string;
  border: BorderGeometry;
};

export const RoundedWithBorder: CanvasShaderType<
  RoundedWithBorderProps,
  ComputedRoundedWithBorderValues
> = {
  props: RoundedWithBorderTemplate.props,
  saveAndRestore: true,
  update(node) {
    const props = this.props!;
    const radius = calcFactoredRadiusArray(
      props.radius as Vec4,
      node.w,
      node.h,
    );
    this.computed.radius = radius;
    this.computed.borderColor = this.toColorString(props['border-color']);
    this.computed.border = computeBorderGeometry(
      node.w,
      node.h,
      radius,
      props['border-w'] as Vec4,
      props['border-align'] as number,
      props['border-gap'] as number,
    );
  },
  render(ctx, node, renderContext) {
    const computed = this.computed as ComputedRoundedWithBorderValues;
    roundedRectWithBorder(
      ctx,
      node.globalTransform!.tx,
      node.globalTransform!.ty,
      node.props.w,
      node.props.h,
      computed.radius,
      computed.border,
      computed.borderColor,
      renderContext,
    );
  },
};
