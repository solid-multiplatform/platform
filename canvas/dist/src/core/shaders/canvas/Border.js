import { computeBorderGeometry, } from '../borderGeometry.js';
import { BorderTemplate, } from '../templates/BorderTemplate.js';
import { fillBorder } from './utils/render.js';
// The square Border has no corner radius; never mutated.
const NO_RADIUS = [0, 0, 0, 0];
export const Border = {
    props: BorderTemplate.props,
    update(node) {
        const props = this.props;
        this.computed.borderColor = this.toColorString(props.color);
        this.computed.border = computeBorderGeometry(node.w, node.h, NO_RADIUS, props.w, props.align, props.gap);
    },
    render(ctx, node, renderContext) {
        renderContext();
        const computed = this.computed;
        const g = computed.border;
        if (g.hasBorder === false) {
            return;
        }
        fillBorder(ctx, node.globalTransform.tx, node.globalTransform.ty, node.props.w, node.props.h, g, NO_RADIUS, NO_RADIUS, computed.borderColor);
    },
};
//# sourceMappingURL=Border.js.map