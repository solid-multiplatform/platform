import { calcFactoredRadiusArray } from '../../lib/utils.js';
import { HolePunchTemplate, } from '../templates/HolePunchTemplate.js';
import { roundRect } from './utils/render.js';
export const HolePunch = {
    props: HolePunchTemplate.props,
    update() {
        this.computed.radius = calcFactoredRadiusArray(this.props.radius, this.props.w, this.props.h);
    },
    render(ctx, quad, renderContext) {
        ctx.save();
        renderContext();
        const { x, y, w, h } = this.props;
        const gt = quad.globalTransform;
        ctx.beginPath();
        roundRect(ctx, gt.tx + x, gt.ty + y, w, h, this.computed.radius);
        ctx.closePath();
        ctx.fillStyle = 'black';
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fill();
        ctx.restore();
    },
};
//# sourceMappingURL=HolePunch.js.map