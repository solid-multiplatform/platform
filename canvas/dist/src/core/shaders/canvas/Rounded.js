import { calcFactoredRadiusArray } from '../../lib/utils.js';
import { RoundedTemplate, } from '../templates/RoundedTemplate.js';
import { roundRect } from './utils/render.js';
export const Rounded = {
    props: RoundedTemplate.props,
    saveAndRestore: true,
    update(node) {
        this.computed.radius = calcFactoredRadiusArray(this.props.radius, node.w, node.h);
    },
    render(ctx, node, renderContext) {
        ctx.beginPath();
        roundRect(ctx, node.globalTransform.tx, node.globalTransform.ty, node.props.w, node.props.h, this.computed.radius);
        ctx.clip();
        renderContext();
    },
};
//# sourceMappingURL=Rounded.js.map