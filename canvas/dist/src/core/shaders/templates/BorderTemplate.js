import { validateArrayLength4 } from '../utils.js';
export function getBorderProps(prefix) {
    const pf = prefix && prefix.length > 0 ? `${prefix}-` : '';
    const w = pf + 'w';
    return {
        [w]: {
            default: [0, 0, 0, 0],
            resolve(value) {
                if (value !== undefined) {
                    return validateArrayLength4(value);
                }
                return [].concat(this.default);
            },
        },
        [pf + 'color']: 0xffffffff,
        [pf + 'align']: {
            default: 1, //outside,
            resolve(value) {
                if (!isNaN(value)) {
                    return value;
                }
                if (typeof value === 'string') {
                    switch (value) {
                        case 'inside':
                            return 0;
                        case 'center':
                            return 0.5;
                        case 'outside':
                            return 1;
                    }
                }
                return this.default;
            },
        },
        [pf + 'gap']: 0,
        [pf + 'top']: {
            default: 0,
            set(value, props) {
                props[w][0] = value;
            },
            get(props) {
                return props[w][0];
            },
        },
        [pf + 'right']: {
            default: 0,
            set(value, props) {
                props[w][1] = value;
            },
            get(props) {
                return props[w][1];
            },
        },
        [pf + 'bottom']: {
            default: 0,
            set(value, props) {
                props[w][2] = value;
            },
            get(props) {
                return props[w][2];
            },
        },
        [pf + 'left']: {
            default: 0,
            set(value, props) {
                props[w][3] = value;
            },
            get(props) {
                return props[w][3];
            },
        },
    };
}
export const BorderTemplate = {
    props: getBorderProps(),
};
//# sourceMappingURL=BorderTemplate.js.map