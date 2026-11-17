import type { CoreNode } from '../CoreNode.js';
import type { Bound } from '../lib/utils.js';
import { clampUnit } from '../lib/utils.js';
import { TextureType, type Texture } from '../textures/Texture.js';
import type { SubTexture } from '../textures/SubTexture.js';

/**
 * Resolve the UV rect a node samples from its texture: subtexture offset,
 * then `resizeMode: 'cover'` crop, then flipX/flipY. Shared by both backends;
 * each supplies its base rect (WebGL: the context texture's own coords,
 * Canvas: 0..1) and wraps the result in its own coords type.
 *
 * Writes into `out` and returns it, so callers can pass a reused scratch
 * object and allocate only the value they keep.
 */
export const resolveUvRect = (
  node: CoreNode,
  texture: Texture,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  out: Bound,
): Bound => {
  if (texture.type === TextureType.subTexture) {
    const { w: parentW, h: parentH } = (texture as SubTexture).parentTexture
      .dimensions!;
    const { x, y, w, h } = (texture as SubTexture).props;
    x1 = x / parentW;
    y1 = y / parentH;
    x2 = x1 + w / parentW;
    y2 = y1 + h / parentH;
  }

  const textureOptions = node.props.textureOptions;
  if (textureOptions !== undefined && textureOptions !== null) {
    const resizeMode = textureOptions.resizeMode;
    const dimensions = texture.dimensions;
    if (
      resizeMode !== undefined &&
      resizeMode.type === 'cover' &&
      dimensions !== null
    ) {
      const w = node.props.w;
      const h = node.props.h;
      const scaleX = w / dimensions.w;
      const scaleY = h / dimensions.h;
      const scale = Math.max(scaleX, scaleY);
      const precision = 1 / scale;

      // Determine based on width
      if (scaleX < scale) {
        const desiredSize = precision * w;
        x1 =
          (1 - desiredSize / dimensions.w) * clampUnit(resizeMode.clipX ?? 0.5);
        x2 = x1 + desiredSize / dimensions.w;
      }
      // Determine based on height
      if (scaleY < scale) {
        const desiredSize = precision * h;
        y1 =
          (1 - desiredSize / dimensions.h) * clampUnit(resizeMode.clipY ?? 0.5);
        y2 = y1 + desiredSize / dimensions.h;
      }
    }

    if (textureOptions.flipX === true) {
      const t = x1;
      x1 = x2;
      x2 = t;
    }
    if (textureOptions.flipY === true) {
      const t = y1;
      y1 = y2;
      y2 = t;
    }
  }

  out.x1 = x1;
  out.y1 = y1;
  out.x2 = x2;
  out.y2 = y2;
  return out;
};
