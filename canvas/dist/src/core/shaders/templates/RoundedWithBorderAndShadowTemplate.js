import { getBorderProps } from './BorderTemplate.js';
import { RoundedTemplate } from './RoundedTemplate.js';
import { getShadowProps } from './ShadowTemplate.js';
const props = Object.assign({}, RoundedTemplate.props, getBorderProps('border'), getShadowProps('shadow'));
export const RoundedWithBorderAndShadowTemplate = {
    props,
};
//# sourceMappingURL=RoundedWithBorderAndShadowTemplate.js.map