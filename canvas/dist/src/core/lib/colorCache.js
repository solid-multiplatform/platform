import { parseToAbgrString, parseToRgbaString } from './colorParser.js';
const parsedArgbColors = new Map();
const parsedRgbaColors = new Map();
export function normalizeCanvasColor(color, isRGBA = false) {
    let targetCache = isRGBA === true ? parsedRgbaColors : parsedArgbColors;
    let out = targetCache.get(color);
    if (out !== undefined) {
        return out;
    }
    if (isRGBA === true) {
        out = parseToRgbaString(color);
    }
    else {
        out = parseToAbgrString(color);
    }
    targetCache.set(color, out);
    return out;
}
//# sourceMappingURL=colorCache.js.map