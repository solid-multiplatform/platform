import type { CoreNode } from '../CoreNode.js';
import type { Bound } from '../lib/utils.js';
import { type Texture } from '../textures/Texture.js';
/**
 * Resolve the UV rect a node samples from its texture: subtexture offset,
 * then `resizeMode: 'cover'` crop, then flipX/flipY. Shared by both backends;
 * each supplies its base rect (WebGL: the context texture's own coords,
 * Canvas: 0..1) and wraps the result in its own coords type.
 *
 * Writes into `out` and returns it, so callers can pass a reused scratch
 * object and allocate only the value they keep.
 */
export declare const resolveUvRect: (node: CoreNode, texture: Texture, x1: number, y1: number, x2: number, y2: number, out: Bound) => Bound;
