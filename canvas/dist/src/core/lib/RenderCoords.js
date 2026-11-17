export class RenderCoords {
    x1;
    y1;
    x2;
    y2;
    x3;
    y3;
    x4;
    y4;
    constructor(x1, y1, x2, y2, x3, y3, x4, y4) {
        this.x1 = x1;
        this.y1 = y1;
        this.x2 = x2;
        this.y2 = y2;
        this.x3 = x3;
        this.y3 = y3;
        this.x4 = x4;
        this.y4 = y4;
    }
    static translate(x1, y1, x2, y2, x3, y3, x4, y4, out) {
        if (out === undefined) {
            return new RenderCoords(x1, y1, x2, y2, x3, y3, x4, y4);
        }
        out.x1 = x1;
        out.y1 = y1;
        out.x2 = x2;
        out.y2 = y2;
        out.x3 = x3;
        out.y3 = y3;
        out.x4 = x4;
        out.y4 = y4;
        return out;
    }
}
//# sourceMappingURL=RenderCoords.js.map