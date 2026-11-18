import { calcFactoredRadiusArray } from '../../lib/utils.js';
import type { CanvasShaderType } from '../../renderers/canvas/CanvasShaderNode.js';
import type { Vec4 } from '../../renderers/webgl/internal/ShaderUtils.js';
import { computeBorderGeometry } from '../borderGeometry.js';
import {
  RoundedWithBorderAndShadowTemplate,
  type RoundedWithBorderAndShadowProps,
} from '../templates/RoundedWithBorderAndShadowTemplate.js';
import type { ComputedRoundedWithBorderValues } from './RoundedWithBorder.js';
import type { ComputedShadowValues } from './Shadow.js';
import * as render from './utils/render.js';

type ComputedValues = ComputedRoundedWithBorderValues & ComputedShadowValues;

export const RoundedWithBorderAndShadow: CanvasShaderType<
  RoundedWithBorderAndShadowProps,
  ComputedValues
> = {
  props: RoundedWithBorderAndShadowTemplate.props,
  saveAndRestore: true,
  update(node) {
    const props = this.props!;
    const radius = calcFactoredRadiusArray(
      props.radius as Vec4,
      node.w,
      node.h,
    );
    const g = computeBorderGeometry(
      node.w,
      node.h,
      radius,
      props['border-w'] as Vec4,
      props['border-align'] as number,
      props['border-gap'] as number,
    );
    this.computed.radius = radius;
    this.computed.borderColor = this.toColorString(props['border-color']);
    this.computed.border = g;

    // Same box select as WebGL: the shadow hugs the outer border box when
    // the border grows past the node on either axis, otherwise the node.
    const blur = props['shadow-blur'];
    const shadowRadius = g.shadowOnOuter === true ? g.outerRadius : radius;
    this.computed.shadowColor = this.toColorString(props['shadow-color']);
    this.computed.shadowRadius = [
      shadowRadius[0] + blur,
      shadowRadius[1] + blur,
      shadowRadius[2] + blur,
      shadowRadius[3] + blur,
    ];
  },
  render(ctx, node, renderContext) {
    const { tx, ty } = node.globalTransform!;
    const { w, h } = node.props;
    const props = this.props!;
    const computed = this.computed as ComputedValues;
    const g = computed.border;
    const outer = g.shadowOnOuter;
    // A zero-alpha shadow is invisible (Canvas draws no shadow at zero alpha,
    // and the fill that casts it is transparent too), so skip the whole pass,
    // as WebGL skips its SDF.
    if ((props['shadow-color'] & 0xff) !== 0) {
      render.shadow(
        ctx,
        outer === true ? tx + w * 0.5 - g.outerUvX - g.outerHalfW : tx,
        outer === true ? ty + h * 0.5 - g.outerUvY - g.outerHalfH : ty,
        outer === true ? g.outerHalfW * 2 : w,
        outer === true ? g.outerHalfH * 2 : h,
        computed.shadowColor,
        props['shadow-projection'],
        computed.shadowRadius,
        this.stage.pixelRatio,
      );
    }
    render.roundedRectWithBorder(
      ctx,
      tx,
      ty,
      w,
      h,
      computed.radius,
      g,
      computed.borderColor,
      renderContext,
    );
  },
};
