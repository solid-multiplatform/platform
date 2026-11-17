export const RadialProgressTemplate = {
    props: {
        width: 8,
        radius: 0,
        progress: {
            default: 1,
            resolve(value) {
                if (value === undefined)
                    return this.default;
                if (value < 0)
                    return 0;
                if (value > 1)
                    return 1;
                return value;
            },
        },
        startAngle: -Math.PI / 2,
        direction: 1,
        colors: {
            default: [0xffffffff],
            resolve(value) {
                if (value !== undefined && value.length > 0) {
                    return value;
                }
                return [].concat(this.default);
            },
        },
        stops: {
            default: [0],
            resolve(value, props) {
                if (value !== undefined && value.length === props.colors.length) {
                    return value;
                }
                if (value === undefined) {
                    value = [];
                }
                const len = props.colors.length;
                if (len === 1) {
                    value[0] = 0;
                    value.length = 1;
                    return value;
                }
                for (let i = 0; i < len; i++) {
                    value[i] = i * (1 / (len - 1));
                }
                value.length = len;
                return value;
            },
        },
        trackColor: 0x00000000,
        cap: 1,
        duration: {
            default: 0,
            resolve(value) {
                if (value === undefined)
                    return this.default;
                if (value < 0)
                    return 0;
                return value;
            },
        },
        countdown: 1,
    },
};
//# sourceMappingURL=RadialProgressTemplate.js.map