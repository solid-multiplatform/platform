export const isProductionEnvironment = typeof __DEV__ !== 'undefined' ? !__DEV__ : true;
export const ENABLE_INSPECTOR = typeof __enableInspector__ !== 'undefined'
    ? __enableInspector__
    : !isProductionEnvironment;
export const EMIT_BOUNDS_EVENTS = typeof __emitBoundsEvents__ !== 'undefined' ? __emitBoundsEvents__ : false;
export const ENABLE_COMPRESSED_TEXTURES = typeof __enableCompressedTextures__ !== 'undefined'
    ? __enableCompressedTextures__
    : false;
//# sourceMappingURL=flags.js.map