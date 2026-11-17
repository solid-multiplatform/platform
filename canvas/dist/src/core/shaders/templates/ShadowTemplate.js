import { validateArrayLength4 } from '../utils.js';
export function getShadowProps(prefix) {
    const pf = prefix && prefix.length > 0 ? `${prefix}-` : '';
    const projection = pf + 'projection';
    return {
        [pf + 'color']: 0x000000ff,
        [projection]: {
            default: [0, 0, 5, 5],
            resolve(value) {
                if (value !== undefined) {
                    return validateArrayLength4(value);
                }
                return [].concat(this.default);
            },
        },
        [pf + 'x']: {
            default: 0,
            set(value, props) {
                props[projection][0] = value;
            },
            get(props) {
                return props[projection][0];
            },
        },
        [pf + 'y']: {
            default: 0,
            set(value, props) {
                props[projection][1] = value;
            },
            get(props) {
                return props[projection][1];
            },
        },
        [pf + 'blur']: {
            default: 5,
            set(value, props) {
                props[projection][2] = value;
            },
            get(props) {
                return props[projection][2];
            },
        },
        [pf + 'spread']: {
            default: 5,
            set(value, props) {
                props[projection][3] = value;
            },
            get(props) {
                return props[projection][3];
            },
        },
    };
}
export const ShadowTemplate = {
    props: getShadowProps(),
};
//# sourceMappingURL=ShadowTemplate.js.map