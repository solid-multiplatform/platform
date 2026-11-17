import { EventEmitter } from '../../common/EventEmitter.js';
import { NULL } from '../nodes/NodeFlags.js';
import { TextureError, TextureErrorCode } from './TextureError.js';
import { F_PREVENT_CLEANUP, KIND_COLOR, KIND_IMAGE, KIND_NOISE, KIND_SUB, TX_UPLOADED, } from './TextureStore.js';
/** 1.10's texture type values. */
export var TextureType;
(function (TextureType) {
    TextureType[TextureType["generic"] = 0] = "generic";
    TextureType[TextureType["color"] = 1] = "color";
    TextureType[TextureType["image"] = 2] = "image";
    TextureType[TextureType["noise"] = 3] = "noise";
    TextureType[TextureType["subTexture"] = 4] = "subTexture";
})(TextureType || (TextureType = {}));
/**
 * The handle's state by record state (idle, queued, loading, decoded,
 * uploaded, failed, freed); the inspector reads it too.
 */
export const TEXTURE_STATE_NAMES = [
    'initial',
    'loading',
    'loading',
    'fetched',
    'loaded',
    'failed',
    'freed',
];
/**
 * The public texture handle (spec 9.1): a thin view of one record in the
 * TextureStore, with a lazy event emitter for `loaded` (dimensions),
 * `failed` (the error) and `freed`. Events are delivered after the frame's
 * draw. `id` is the record id; the handle also keeps, internally, the slot
 * generation it was bound at, so a record removed since
 * (TextureStore.destroy) reads as freed, even through a handle that was not
 * the record's own.
 */
export class Texture extends EventEmitter {
    constructor(store, id, type, props) {
        super();
        /** Internal: the last preventCleanup written, applied again on revival. */
        this._keep = false;
        this.store = store;
        this.id = id;
        this._gen = store.gen[id];
        this.type = type;
        this.props = props;
    }
    /** 'freed' once its record was removed (it reloads when used again). */
    get state() {
        const id = liveRecord(this.store, this);
        return id === NULL ? 'freed' : TEXTURE_STATE_NAMES[this.store.state[id]];
    }
    /** The pixel size once uploaded, else null. */
    get dimensions() {
        const store = this.store;
        const id = liveRecord(store, this);
        if (id === NULL || store.state[id] !== TX_UPLOADED) {
            return null;
        }
        return { w: store.w[id], h: store.h[id] };
    }
    get error() {
        const id = liveRecord(this.store, this);
        return id === NULL ? null : this.store.errors[id];
    }
    /** Never evicted under memory pressure while set. */
    get preventCleanup() {
        const id = liveRecord(this.store, this);
        if (id === NULL) {
            return this._keep;
        }
        return (this.store.flags[id] & F_PREVENT_CLEANUP) !== 0;
    }
    set preventCleanup(v) {
        this._keep = v;
        const id = liveRecord(this.store, this);
        if (id !== NULL) {
            this.store.setPreventCleanup(id, v);
        }
    }
    /**
     * Load the pixels now, without a node wanting them (1.10's load()): to
     * have a texture uploaded before a node shows it. A SubTexture loads its
     * sheet. Once uploaded it is freed by a cleanup like any texture nobody
     * wants, unless preventCleanup is set: set it before load() to keep the
     * texture until a node shows it, and clear it then.
     */
    load() {
        this.store.load(textureRecord(this.store, this));
    }
}
/** `handle`'s record, or NULL once it was removed. */
export function liveRecord(store, handle) {
    const id = handle.id;
    return id !== NULL && store.gen[id] === handle._gen ? id : NULL;
}
/**
 * A texture loaded from an image source (spec 9.3). Its props are its
 * record's: a copy with every default filled in (1.10 resolveDefaults).
 */
export class ImageTexture extends Texture {
}
/**
 * The props a new image record keeps: a copy of `p` with 1.10's defaults
 * (resolveDefaults), so that a caller reusing its object retargets nothing
 * and the handle reads complete props. maxRetryCount defaults to the
 * renderer's setting (spec 14). TextureNodes builds a `src` node's in the
 * same shape.
 */
function imageProps(store, p) {
    return {
        src: p.src ?? '',
        premultiplyAlpha: p.premultiplyAlpha ?? true,
        key: p.key ?? null,
        type: p.type ?? null,
        w: p.w ?? null,
        h: p.h ?? null,
        sx: p.sx ?? null,
        sy: p.sy ?? null,
        sw: p.sw ?? null,
        sh: p.sh ?? null,
        maxRetryCount: p.maxRetryCount ?? store.maxRetries,
    };
}
/**
 * A region of a parent texture (a sprite sheet): it draws its parent's GL
 * texture through its own UVs (spec 9.6), so sprites of one sheet batch.
 * It reports its parent's state and error, and its region's size, and its
 * preventCleanup is the parent's, which holds the pixels. A region of a
 * SubTexture is made a region of that one's sheet, the offsets added up
 * (1.10 accepted only an ImageTexture parent). Made on a parent already
 * loaded, failed or freed, it hears that (RendererCore.createTexture) after
 * the frame's draw or from a zero-delay timer (1.10: a microtask).
 */
export class SubTexture extends Texture {
    /** The texture whose pixels it shows (1.10's name). */
    get parentTexture() {
        return this.props.texture;
    }
    get state() {
        return this.props.texture.state;
    }
    get dimensions() {
        const p = this.props;
        return p.texture.state === 'loaded' ? { w: p.w, h: p.h } : null;
    }
    get error() {
        return this.props.texture.error;
    }
    get preventCleanup() {
        return this.props.texture.preventCleanup;
    }
    set preventCleanup(v) {
        this.props.texture.preventCleanup = v;
    }
}
/** A 1x1 pixel of one colour, stretched over the node. */
export class ColorTexture extends Texture {
    get color() {
        return this.props.color;
    }
}
/** Random grey pixels, generated when first wanted. */
export class NoiseTexture extends Texture {
}
/**
 * 1.10's ImageTexture cache key: the key (or a string src), premultiply,
 * and a crop when sw and sh are set; null for a source with no string
 * identity, which is then not cached.
 */
export function imageKey(src, key, premultiplyAlpha, sx, sy, sw, sh) {
    const id = key !== undefined && key !== null && key !== '' ? key : src;
    if (typeof id !== 'string') {
        return null;
    }
    let out = `ImageTexture,${id},${premultiplyAlpha ?? true}`;
    if (sw !== null && sw !== undefined && sh !== null && sh !== undefined) {
        // A size of 0 keys as unset (1.10 wrote `sw || ''`).
        out += `,${sx ?? ''},${sy ?? ''},${sw === 0 ? '' : sw},${sh === 0 ? '' : sh}`;
    }
    return out;
}
/**
 * The record for a texture of `type` and `props`: cached, or new. The
 * other types' props come resolved; an image's are copied only on a miss,
 * as 1.10 resolved them only then.
 */
function recordFor(store, type, props) {
    let kind = KIND_IMAGE;
    let key = null;
    if (type === TextureType.subTexture) {
        const parent = props.texture;
        return store.create(KIND_SUB, props, null, textureRecord(store, parent));
    }
    if (type === TextureType.image) {
        const p = props;
        key = imageKey(p.src, p.key, p.premultiplyAlpha, p.sx, p.sy, p.sw, p.sh);
    }
    else if (type === TextureType.color) {
        kind = KIND_COLOR;
        key = `ColorTexture,${props.color}`;
    }
    else {
        kind = KIND_NOISE;
        const p = props;
        key =
            p.cacheId === undefined
                ? null
                : `NoiseTexture,${p.w},${p.h},${p.cacheId}`;
    }
    const cached = key === null ? undefined : store.cache.get(key);
    if (cached !== undefined) {
        return cached;
    }
    return store.create(kind, type === TextureType.image
        ? imageProps(store, props)
        : props, key);
}
/**
 * The record a node shows for `handle`: its own, or, once that was removed
 * (MemoryManager), a record it gets back (reviveTexture).
 */
export function textureRecord(store, handle) {
    const id = liveRecord(store, handle);
    return id === NULL ? reviveTexture(store, handle) : id;
}
/**
 * A handle whose record was removed as an orphan (MemoryManager) reads as
 * freed; used again, it gets a record back (a cached one for the same
 * source, or a new one), as a destroyed 1.10 texture reloaded when used,
 * with the preventCleanup it was given.
 */
export function reviveTexture(store, handle) {
    const rec = recordFor(store, handle.type, handle.props);
    handle.id = rec;
    handle._gen = store.gen[rec];
    if (store.handles[rec] === null) {
        store.handles[rec] = handle;
    }
    if (handle._keep === true) {
        store.setPreventCleanup(rec, true);
    }
    return rec;
}
/**
 * renderer.createTexture (spec 9.1): the record is created now and loads
 * when a node in bounds, or a preloading node, wants its pixels. A cached
 * source returns the handle it already has.
 */
export function createTexture(store, type, props) {
    // App code, between frames as often as not: the clock, not the last
    // frame's time, starts the record's grace period.
    store.time = store.now();
    let textureType;
    let resolved;
    if (type === 'ImageTexture') {
        textureType = TextureType.image;
        resolved = props;
    }
    else if (type === 'SubTexture') {
        const p = props;
        textureType = TextureType.subTexture;
        let parent = p.texture;
        let x = p.x ?? 0;
        let y = p.y ?? 0;
        // A resolved region's texture is always a sheet: one step reaches it.
        if (parent.type === TextureType.subTexture) {
            const region = parent.props;
            x += region.x;
            y += region.y;
            parent = region.texture;
        }
        resolved = { texture: parent, x, y, w: p.w ?? 0, h: p.h ?? 0 };
    }
    else if (type === 'ColorTexture') {
        textureType = TextureType.color;
        // 0 reads as unset, white, as 1.10's `color || 0xffffffff` did.
        const color = props.color ?? 0;
        resolved = { color: color === 0 ? 0xffffffff : color };
    }
    else if (type === 'NoiseTexture') {
        const p = props;
        textureType = TextureType.noise;
        resolved = { w: p.w ?? 128, h: p.h ?? 128, cacheId: p.cacheId };
    }
    else {
        throw new TextureError(TextureErrorCode.TEXTURE_TYPE_NOT_REGISTERED, `Texture type "${String(type)}" is not registered`);
    }
    const rec = recordFor(store, textureType, resolved);
    let handle = store.handles[rec];
    if (handle === null) {
        const Class = textureType === TextureType.image
            ? ImageTexture
            : textureType === TextureType.subTexture
                ? SubTexture
                : textureType === TextureType.color
                    ? ColorTexture
                    : NoiseTexture;
        // The record's props, not the caller's: a cached record (one a node
        // created included) keeps the ones it was made with (1.10 returned the
        // cached texture).
        handle = new Class(store, rec, textureType, store.props[rec]);
        store.handles[rec] = handle;
    }
    return handle;
}
//# sourceMappingURL=Texture.js.map