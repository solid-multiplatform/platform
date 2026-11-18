import type { ClippingValue, ImageType, INodeProps, Node } from './Node.js';
import type { TextureOptions } from '../../common/types.js';

/**
 * Apply a props bag to a node in 1.10 precedence order: group values first
 * (individual corner/axis values are applied afterwards so they win over
 * their shorthand), then the plain keys, then `parent` last. Cost is
 * proportional to the keys passed, not to the full prop set (spec 5.2).
 *
 * Applies to a fresh node (createNode); `null` and `undefined` both mean
 * "use the default", matching 1.10's `resolveNodeDefaults`, which used `??`
 * throughout (`props.alpha ?? 1`, `props.clipping ?? false`, the colour and
 * scale/mount/pivot chains, and so on) and so never distinguished an
 * explicit `null` from an omitted key. Every group check below and the
 * loop's skip both treat the two the same; a fresh node already carries the
 * correct default in its store slot, so skipping leaves the default in
 * place, whereas writing `null` through the setters would coerce it into a
 * live value instead (a Float64Array write coerces `null` to `0`, a colour
 * setter's `v >>> 0` also turns it into `0`, and `clipping`'s `v !== false`
 * test would make `null` clip).
 *
 * Plain keys are dispatched with `switch (key)`, one named store per case,
 * rather than a keyed store (`target[key] = value`) on the node itself: a
 * runtime string key landing on a prototype accessor is a megamorphic
 * keyed-store IC (a runtime call per prop) on Chrome 38's Crankshaft, and
 * node creation cost is a headline v2 goal (spec 1.1: 5x faster than 1.10).
 */
export function applyNodeProps(node: Node, props: Partial<INodeProps>): void {
  if (props.color !== undefined && props.color !== null)
    node.color = props.color;
  if (props.colorLeft !== undefined && props.colorLeft !== null)
    node.colorLeft = props.colorLeft;
  if (props.colorRight !== undefined && props.colorRight !== null)
    node.colorRight = props.colorRight;
  if (props.colorTop !== undefined && props.colorTop !== null)
    node.colorTop = props.colorTop;
  if (props.colorBottom !== undefined && props.colorBottom !== null)
    node.colorBottom = props.colorBottom;
  if (props.scale !== undefined && props.scale !== null)
    node.scale = props.scale;
  if (props.mount !== undefined && props.mount !== null)
    node.mount = props.mount;
  if (props.pivot !== undefined && props.pivot !== null)
    node.pivot = props.pivot;

  const bag = props as Record<string, unknown>;
  for (const key in bag) {
    const value = bag[key];
    if (value === undefined || value === null) {
      continue;
    }
    switch (key) {
      case 'x':
        node.x = value as number;
        break;
      case 'y':
        node.y = value as number;
        break;
      case 'w':
        node.w = value as number;
        break;
      case 'h':
        node.h = value as number;
        break;
      case 'alpha':
        node.alpha = value as number;
        break;
      case 'colorTl':
        node.colorTl = value as number;
        break;
      case 'colorTr':
        node.colorTr = value as number;
        break;
      case 'colorBl':
        node.colorBl = value as number;
        break;
      case 'colorBr':
        node.colorBr = value as number;
        break;
      case 'scaleX':
        node.scaleX = value as number;
        break;
      case 'scaleY':
        node.scaleY = value as number;
        break;
      case 'rotation':
        node.rotation = value as number;
        break;
      case 'mountX':
        node.mountX = value as number;
        break;
      case 'mountY':
        node.mountY = value as number;
        break;
      case 'pivotX':
        node.pivotX = value as number;
        break;
      case 'pivotY':
        node.pivotY = value as number;
        break;
      case 'zIndex':
        node.zIndex = value as number;
        break;
      case 'clipping':
        node.clipping = value as ClippingValue;
        break;
      case 'ignoreParentAlpha':
        node.ignoreParentAlpha = value as boolean;
        break;
      case 'placeholderColor':
        node.placeholderColor = value as number;
        break;
      case 'autosize':
        node.autosize = value as boolean;
        break;
      case 'rtl':
        node.rtl = value as boolean;
        break;
      case 'data':
        node.data = value as Record<string, unknown> | null;
        break;
      case 'src':
        // After the loop: 1.10 applied src after texture at creation, so
        // createNode({ texture, src }) shows src in any key order.
        break;
      case 'srcX':
        node.srcX = value as number;
        break;
      case 'srcY':
        node.srcY = value as number;
        break;
      case 'srcWidth':
        node.srcWidth = value as number;
        break;
      case 'srcHeight':
        node.srcHeight = value as number;
        break;
      case 'imageType':
        node.imageType = value as ImageType;
        break;
      case 'textureOptions':
        node.textureOptions = value as TextureOptions | null;
        break;
      case 'texture':
        node.texture = value as object | null;
        break;
      case 'shader':
        node.shader = value as object | null;
        break;
      case 'componentName':
        node.componentName = value as string;
        break;
      case 'componentLocation':
        node.componentLocation = value as string;
        break;
      case 'atlasGroup':
        node.atlasGroup = value as string;
        break;
      default:
        break;
    }
  }

  if (props.src !== undefined && props.src !== null) node.src = props.src;
  if (props.parent !== undefined && props.parent !== null)
    node.parent = props.parent;
}
