import { validateArrayLength4 } from '../utils.js';
export const RoundedTemplate = {
    props: {
        radius: {
            default: [0, 0, 0, 0],
            resolve(value) {
                if (value !== undefined) {
                    return validateArrayLength4(value);
                }
                return [].concat(this.default);
            },
        },
        'top-left': {
            default: 0,
            set(value, props) {
                props.radius[0] = value;
            },
            get(props) {
                return props.radius[0];
            },
        },
        'top-right': {
            default: 0,
            set(value, props) {
                props.radius[1] = value;
            },
            get(props) {
                return props.radius[1];
            },
        },
        'bottom-right': {
            default: 0,
            set(value, props) {
                props.radius[2] = value;
            },
            get(props) {
                return props.radius[2];
            },
        },
        'bottom-left': {
            default: 0,
            set(value, props) {
                props.radius[3] = value;
            },
            get(props) {
                return props.radius[3];
            },
        },
    },
};
//# sourceMappingURL=RoundedTemplate.js.map