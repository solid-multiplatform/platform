/**
 * Build-time flags.
 *
 * Each one reads a global the bundler is expected to substitute. When the
 * global is undefined the expression stays a runtime `typeof` check and the
 * guarded code survives tree shaking (see README, "Build-time Flags").
 */
declare const __DEV__: boolean;
declare const __enableInspector__: boolean;
declare const __emitBoundsEvents__: boolean;
declare const __enableCompressedTextures__: boolean;

export const isProductionEnvironment: boolean =
  typeof __DEV__ !== 'undefined' ? !__DEV__ : true;

export const ENABLE_INSPECTOR: boolean =
  typeof __enableInspector__ !== 'undefined'
    ? __enableInspector__
    : !isProductionEnvironment;

export const EMIT_BOUNDS_EVENTS: boolean =
  typeof __emitBoundsEvents__ !== 'undefined' ? __emitBoundsEvents__ : false;

export const ENABLE_COMPRESSED_TEXTURES: boolean =
  typeof __enableCompressedTextures__ !== 'undefined'
    ? __enableCompressedTextures__
    : false;
