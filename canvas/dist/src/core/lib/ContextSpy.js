/**
 * Class that keeps track of the invocations of Context methods when
 * the `enableContextSpy` renderer option is enabled.
 */
export class ContextSpy {
    data = {};
    reset() {
        this.data = {};
    }
    increment(name) {
        if (!this.data[name]) {
            this.data[name] = 0;
        }
        this.data[name]++;
    }
    getData() {
        return { ...this.data };
    }
}
//# sourceMappingURL=ContextSpy.js.map