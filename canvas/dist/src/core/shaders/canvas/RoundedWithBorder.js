import { calcFactoredRadiusArray } from '../../lib/utils.js';
import { computeBorderGeometry, } from '../borderGeometry.js';
import { RoundedWithBorderTemplate, } from '../templates/RoundedWithBorderTemplate.js';
import { roundedRectWithBorder } from './utils/render.js';
export const RoundedWithBorder = {
    props: RoundedWithBorderTemplate.props,
    saveAndRestore: true,
    update(node) {
        const props = this.props;
        const radius = calcFactoredRadiusArray(props.radius, node.w, node.h);
        this.computed.radius = radius;
        this.computed.borderColor = this.toColorString(props['border-color']);
        this.computed.border = computeBorderGeometry(node.w, node.h, radius, props['border-w'], props['border-align'], props['border-gap']);
    },
    render(ctx, node, renderContext) {
        const computed = this.computed;
        roundedRectWithBorder(ctx, node.globalTransform.tx, node.globalTransform.ty, node.props.w, node.props.h, computed.radius, computed.border, computed.borderColor, renderContext);
    },
};
//# sourceMappingURL=RoundedWithBorder.js.map