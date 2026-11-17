/**
 * Represents a collection of WebGL Buffers along with their associated
 * vertex attribute formats.
 */
export class BufferCollection {
    config;
    _lookup = new Map();
    constructor(config) {
        this.config = config;
        for (const item of config) {
            for (const attrName in item.attributes) {
                // We only care about attributes that are actually defined (truthy)
                // and we want the first one found in the config array order
                if (item.attributes[attrName] && !this._lookup.has(attrName)) {
                    this._lookup.set(attrName, item);
                }
            }
        }
    }
    /**
     * Get the WebGLBuffer associated with the given attribute name if it exists.
     *
     * @param attributeName
     * @returns
     */
    getBuffer(attributeName) {
        return this._lookup.get(attributeName)?.buffer;
    }
    /**
     * Get the AttributeInfo associated with the given attribute name if it exists.
     *
     * @param attributeName
     * @returns
     */
    getAttributeInfo(attributeName) {
        return this._lookup.get(attributeName)?.attributes[attributeName];
    }
}
//# sourceMappingURL=BufferCollection.js.map