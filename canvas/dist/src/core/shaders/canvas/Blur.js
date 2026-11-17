import { BlurTemplate } from '../templates/BlurTemplate.js';
/**
 * Canvas2D Blur backed by the native `ctx.filter = 'blur(Npx)'`. Browsers that
 * lack filter support (Chrome 38-52) will silently no-op — accept the
 * degradation rather than emulating a multi-pass blur in JS.
 */
export const Blur = {
    props: BlurTemplate.props,
    saveAndRestore: true,
    update() {
        this.computed.filter = `blur(${this.props.amount}px)`;
    },
    render(ctx, _node, renderContext) {
        ctx.filter = this.computed.filter;
        renderContext();
    },
};
//# sourceMappingURL=Blur.js.map