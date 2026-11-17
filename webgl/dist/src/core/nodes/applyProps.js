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
export function applyNodeProps(node, props) {
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
    const bag = props;
    for (const key in bag) {
        const value = bag[key];
        if (value === undefined || value === null) {
            continue;
        }
        switch (key) {
            case 'x':
                node.x = value;
                break;
            case 'y':
                node.y = value;
                break;
            case 'w':
                node.w = value;
                break;
            case 'h':
                node.h = value;
                break;
            case 'alpha':
                node.alpha = value;
                break;
            case 'colorTl':
                node.colorTl = value;
                break;
            case 'colorTr':
                node.colorTr = value;
                break;
            case 'colorBl':
                node.colorBl = value;
                break;
            case 'colorBr':
                node.colorBr = value;
                break;
            case 'scaleX':
                node.scaleX = value;
                break;
            case 'scaleY':
                node.scaleY = value;
                break;
            case 'rotation':
                node.rotation = value;
                break;
            case 'mountX':
                node.mountX = value;
                break;
            case 'mountY':
                node.mountY = value;
                break;
            case 'pivotX':
                node.pivotX = value;
                break;
            case 'pivotY':
                node.pivotY = value;
                break;
            case 'zIndex':
                node.zIndex = value;
                break;
            case 'clipping':
                node.clipping = value;
                break;
            case 'ignoreParentAlpha':
                node.ignoreParentAlpha = value;
                break;
            case 'placeholderColor':
                node.placeholderColor = value;
                break;
            case 'autosize':
                node.autosize = value;
                break;
            case 'rtl':
                node.rtl = value;
                break;
            case 'data':
                node.data = value;
                break;
            case 'src':
                // After the loop: 1.10 applied src after texture at creation, so
                // createNode({ texture, src }) shows src in any key order.
                break;
            case 'srcX':
                node.srcX = value;
                break;
            case 'srcY':
                node.srcY = value;
                break;
            case 'srcWidth':
                node.srcWidth = value;
                break;
            case 'srcHeight':
                node.srcHeight = value;
                break;
            case 'imageType':
                node.imageType = value;
                break;
            case 'textureOptions':
                node.textureOptions = value;
                break;
            case 'texture':
                node.texture = value;
                break;
            case 'shader':
                node.shader = value;
                break;
            case 'componentName':
                node.componentName = value;
                break;
            case 'componentLocation':
                node.componentLocation = value;
                break;
            case 'atlasGroup':
                node.atlasGroup = value;
                break;
            default:
                break;
        }
    }
    if (props.src !== undefined && props.src !== null)
        node.src = props.src;
    if (props.parent !== undefined && props.parent !== null)
        node.parent = props.parent;
}
//# sourceMappingURL=applyProps.js.map