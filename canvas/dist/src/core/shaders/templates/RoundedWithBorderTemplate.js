import { getBorderProps } from './BorderTemplate.js';
import { RoundedTemplate } from './RoundedTemplate.js';
const props = Object.assign({}, RoundedTemplate.props, getBorderProps('border'), {
    'border-fill': 0x00000000,
});
export const RoundedWithBorderTemplate = {
    props,
};
//# sourceMappingURL=RoundedWithBorderTemplate.js.map