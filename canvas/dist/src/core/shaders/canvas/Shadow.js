import { ShadowTemplate, } from '../templates/ShadowTemplate.js';
import { shadow } from './utils/render.js';
export const Shadow = {
    props: ShadowTemplate.props,
    update() {
        this.computed.shadowColor = this.toColorString(this.props['color']);
        const blur = this.props['blur'];
        this.computed.shadowRadius = [blur, blur, blur, blur];
    },
    render(ctx, node, renderContext) {
        const { tx, ty } = node.globalTransform;
        const { w, h } = node.props;
        shadow(ctx, tx, ty, w, h, this.computed.shadowColor, this.props['projection'], this.computed.shadowRadius, this.stage.pixelRatio);
        renderContext();
    },
};
//# sourceMappingURL=Shadow.js.map