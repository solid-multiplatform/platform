/**
 * The built-in shader types (spec 8.3), under their 1.10 names: what
 * `@solidtv/renderer/shaders` (and its 1.10 alias `./webgl/shaders`)
 * exports, for `renderer.registerShaderType`.
 */
export { Rounded, Border, RoundedWithBorder, RoundedWithShadow, RoundedWithBorderAndShadow, Shadow, type RoundedProps, type BorderProps, type ShadowProps, type RoundedWithBorderProps, type RoundedWithShadowProps, type RoundedWithBorderAndShadowProps, } from './Box.js';
export { LinearGradient, type LinearGradientProps } from './LinearGradient.js';
export { RadialGradient, type RadialGradientProps } from './RadialGradient.js';
export { HolePunch, type HolePunchProps } from './HolePunch.js';
export { EdgeFade, type EdgeFadeProps } from './EdgeFade.js';
export { RadialProgress, type RadialProgressProps } from './RadialProgress.js';
export { Blur, type BlurProps } from './Blur.js';
