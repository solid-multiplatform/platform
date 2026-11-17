export const LinearGradientTemplate = {
    props: {
        colors: {
            default: [0x000000ff, 0xffffffff],
            resolve(value) {
                if (value !== undefined && value.length > 0) {
                    return value;
                }
                return [].concat(this.default);
            },
        },
        stops: {
            default: [0, 1],
            resolve(value, props) {
                if (value !== undefined && value.length === props.colors.length) {
                    return value;
                }
                if (value === undefined) {
                    value = [];
                }
                const len = props.colors.length;
                for (let i = 0; i < len; i++) {
                    value[i] = i * (1 / (len - 1));
                }
                return value;
            },
        },
        angle: 0,
    },
};
//# sourceMappingURL=LinearGradientTemplate.js.map