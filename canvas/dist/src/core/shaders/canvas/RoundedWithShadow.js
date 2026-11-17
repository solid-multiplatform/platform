import { calcFactoredRadiusArray } from '../../lib/utils.js';
import { RoundedWithShadowTemplate, } from '../templates/RoundedWithShadowTemplate.js';
import * as render from './utils/render.js';
export const RoundedWithShadow = {
    props: RoundedWithShadowTemplate.props,
    saveAndRestore: true,
    update(node) {
        const props = this.props;
        const radius = calcFactoredRadiusArray(props.radius, node.w, node.h);
        this.computed.radius = radius;
        this.computed.shadowColor = this.toColorString(props['shadow-color']);
        this.computed.shadowRadius = radius.map((value) => value + props['shadow-blur']);
    },
    render(ctx, node, renderContext) {
        const { tx, ty } = node.globalTransform;
        const { w, h } = node.props;
        const computed = this.computed;
        if (this.props['shadow-color'] !== 0) {
            render.shadow(ctx, tx, ty, w, h, computed.shadowColor, this.props['shadow-projection'], computed.shadowRadius, this.stage.pixelRatio);
        }
        ctx.beginPath();
        render.roundRect(ctx, tx, ty, w, h, computed.radius);
        ctx.clip();
        renderContext();
    },
};
//# sourceMappingURL=RoundedWithShadow.js.map