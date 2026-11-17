/**
 * Lightning 3 Renderer API
 *
 * @remarks
 * This module exports the API for the Lightning 3 Renderer. You
 * can import the exports from this module like so:
 * ```ts
 * import { Renderer } from '@lightning/renderer';
 * ```
 *
 * Generally developers/frameworks using the Renderer will use the Main API to
 * render applications.
 *
 * Do not confuse the Main API with the Core API which is used to extend
 * capabilities of the Renderer. The Main API code always runs from the main
 * thread.
 *
 * @module Renderer
 */
export * from '../src/main-api/INode.js';
export * from '../src/main-api/Renderer.js';
export * from '../src/common/IAnimationController.js';
export * from '../src/common/CommonTypes.js';
// Selected types exported from the Core Renderer that can be used in the
// context of the main API.
export { CoreTextureManager, } from '../src/core/CoreTextureManager.js';
export { TextureError, TextureErrorCode, isTextureError, } from '../src/core/TextureError.js';
// Font prefetching. Stage-free by design so an app can start font downloads
// before constructing the renderer; pulls in no GL or text-renderer code.
export { prefetchFont, clearFontPrefetch, } from '../src/core/text-rendering/FontPrefetch.js';
export * from '../src/core/renderers/CoreShaderNode.js';
export * from '../src/core/shaders/templates/BorderTemplate.js';
export * from '../src/core/shaders/templates/HolePunchTemplate.js';
export * from '../src/core/shaders/templates/RoundedTemplate.js';
export * from '../src/core/shaders/templates/ShadowTemplate.js';
export * from '../src/core/shaders/templates/LinearGradientTemplate.js';
export * from '../src/core/shaders/templates/EdgeFadeTemplate.js';
export * from '../src/core/shaders/templates/RadialGradientTemplate.js';
// Shaders
export * from '../src/core/renderers/webgl/WebGlShaderProgram.js';
// Textures
export * from '../src/core/textures/Texture.js';
export { ImageTexture } from '../src/core/textures/ImageTexture.js';
//# sourceMappingURL=index.js.map