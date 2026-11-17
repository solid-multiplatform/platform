import { validateArrayLength4 } from '../utils.js';
export const HolePunchTemplate = {
    props: {
        x: 0,
        y: 0,
        w: 50,
        h: 50,
        radius: {
            default: [0, 0, 0, 0],
            resolve(value) {
                if (value !== undefined) {
                    return validateArrayLength4(value);
                }
                return [].concat(this.default);
            },
        },
    },
};
//# sourceMappingURL=HolePunchTemplate.js.map