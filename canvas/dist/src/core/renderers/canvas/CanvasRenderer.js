import { TextureType } from '../../textures/Texture.js';
import { CoreRenderer, } from '../CoreRenderer.js';
import { CanvasTexture } from './CanvasTexture.js';
import { parseColor } from '../../lib/colorParser.js';
import { resolveUvRect } from '../uvRect.js';
import { CanvasShaderNode } from './CanvasShaderNode.js';
import { normalizeCanvasColor } from '../../lib/colorCache.js';
export class CanvasRenderer extends CoreRenderer {
    context;
    canvas;
    pixelRatio;
    clearColor;
    clearColorAlpha;
    // Scratch state for the preallocated shader renderContext callback below —
    // valid only for the duration of the shader render() call in addQuad.
    shaderContextNode = null;
    shaderContextTexture = null;
    shaderRenderContext = () => {
        this.renderContext(this.shaderContextNode, this.shaderContextTexture);
    };
    constructor(options) {
        super(options);
        this.mode = 'canvas';
        const { canvas } = options;
        this.canvas = canvas;
        this.context = canvas.getContext('2d');
        this.pixelRatio = this.stage.pixelRatio;
        this.clearColor = normalizeCanvasColor(this.stage.clearColor);
        this.clearColorAlpha = (this.stage.clearColor >>> 24) & 0xff;
    }
    reset() {
        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;
        // The frame's save/restore pairs are balanced, so resetting the transform
        // and clearing is equivalent to the `canvas.width = canvas.width` trick
        // without tearing down the backing store every frame.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        if (this.clearColorAlpha !== 0) {
            ctx.fillStyle = this.clearColor;
            ctx.fillRect(0, 0, w, h);
        }
        ctx.scale(this.pixelRatio, this.pixelRatio);
    }
    render() {
        // noop
    }
    addQuad(node, renderTexture) {
        const ctx = this.context;
        const { tx, ty, ta, tb, tc, td } = node.globalTransform;
        const clippingRect = node.clippingRect;
        // Already resolved by CoreNode.renderQuads on the frame path (it needs the
        // texture for its own `state` check). While a placeholder is showing,
        // render the color-rect path (the default ColorTexture) tinted by the
        // node's premultiplied placeholder color.
        let texture = (renderTexture !== undefined
            ? renderTexture
            : node.placeholderActive === true
                ? this.stage.defaultTexture
                : node.props.texture || this.stage.defaultTexture);
        // The Canvas2D renderer only supports image textures, no textures are used for color blocks
        if (texture !== null) {
            const textureType = texture.type;
            if (textureType !== TextureType.image &&
                textureType !== TextureType.subTexture &&
                textureType !== TextureType.color &&
                textureType !== TextureType.noise) {
                return;
            }
        }
        const hasTransform = ta !== 1 || td !== 1 || tb !== 0 || tc !== 0;
        const clippingValid = clippingRect.valid === true;
        // If the clipping rect is valid but zero-area, the node is fully clipped — skip rendering
        if (clippingValid === true &&
            clippingRect.w === 0 &&
            clippingRect.h === 0) {
            return;
        }
        const hasClipping = clippingValid === true && clippingRect.w !== 0 && clippingRect.h !== 0;
        const shader = node.props.shader;
        const hasShader = shader !== null;
        let saveAndRestore = hasTransform === true || hasClipping === true;
        if (hasShader === true) {
            saveAndRestore = saveAndRestore || shader.applySNR;
        }
        if (saveAndRestore) {
            ctx.save();
        }
        if (hasClipping === true) {
            ctx.beginPath();
            ctx.rect(clippingRect.x, clippingRect.y, clippingRect.w, clippingRect.h);
            ctx.clip();
        }
        if (hasTransform === true) {
            // Quad transform:
            // | ta tb tx |
            // | tc td ty |
            // | 0  0  1  |
            // C2D transform:
            // | a  c  e  |
            // | b  d  f  |
            // | 0  0  1  |
            const scale = this.pixelRatio;
            ctx.setTransform(ta, tc, tb, td, tx * scale, ty * scale);
            ctx.scale(scale, scale);
            ctx.translate(-tx, -ty);
        }
        if (hasShader === true) {
            this.shaderContextNode = node;
            this.shaderContextTexture = texture;
            shader.render(ctx, node, this.shaderRenderContext);
            this.shaderContextNode = null;
            this.shaderContextTexture = null;
        }
        else {
            this.renderContext(node, texture);
        }
        if (saveAndRestore) {
            ctx.restore();
        }
    }
    renderContext(node, texture) {
        const color = node.premultipliedColorTl;
        const textureType = texture.type;
        const tx = node.globalTransform.tx;
        const ty = node.globalTransform.ty;
        const width = node.props.w;
        const height = node.props.h;
        if (textureType !== TextureType.color) {
            const tintColor = parseColor(color);
            let image;
            if (textureType === TextureType.subTexture) {
                image = texture.parentTexture.ctxTexture.getImage(tintColor);
            }
            else {
                image = texture.ctxTexture.getImage(tintColor);
            }
            // The texture can disappear while an async load/fetch is racing (e.g. 404);
            // skip drawing this frame instead of dereferencing an invalid image object.
            if (image === null || image === undefined) {
                return;
            }
            const imageWidth = image.width;
            const imageHeight = image.height;
            if (typeof imageWidth !== 'number' ||
                typeof imageHeight !== 'number' ||
                imageWidth <= 0 ||
                imageHeight <= 0) {
                return;
            }
            this.context.globalAlpha = tintColor.a ?? node.worldAlpha;
            const txCoords = node.textureCoords;
            if (txCoords) {
                const ix = imageWidth;
                const iy = imageHeight;
                let sx = txCoords.x1 * ix;
                let sy = txCoords.y1 * iy;
                let sw = (txCoords.x2 - txCoords.x1) * ix;
                let sh = (txCoords.y2 - txCoords.y1) * iy;
                let flipX = false;
                let flipY = false;
                if (sw < 0) {
                    flipX = true;
                    sx += sw;
                    sw = Math.abs(sw);
                }
                if (sh < 0) {
                    flipY = true;
                    sy += sh;
                    sh = Math.abs(sh);
                }
                if (flipX || flipY) {
                    this.context.save();
                    this.context.translate(tx + (flipX ? width : 0), ty + (flipY ? height : 0));
                    this.context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
                    this.context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
                    this.context.restore();
                }
                else {
                    this.context.drawImage(image, sx, sy, sw, sh, tx, ty, width, height);
                }
            }
            else {
                this.context.drawImage(image, tx, ty, width, height);
            }
            this.context.globalAlpha = 1;
            return;
        }
        const hasGradient = node.premultipliedColorTl !== node.premultipliedColorTr ||
            node.premultipliedColorTl !== node.premultipliedColorBr;
        if (hasGradient === true) {
            let endX = tx;
            let endY = ty;
            let endColor;
            if (node.premultipliedColorTl === node.premultipliedColorTr) {
                // vertical
                endX = tx;
                endY = ty + height;
                endColor = node.premultipliedColorBr;
            }
            else {
                // horizontal
                endX = tx + width;
                endY = ty;
                endColor = node.premultipliedColorTr;
            }
            let startColor = color;
            const startAlpha = (startColor >>> 24) & 0xff;
            const endAlpha = (endColor >>> 24) & 0xff;
            // if one of the colors has 0 alpha, we want to match the RGB channels
            // to the other color to prevent white bleed during zero alpha interpolation.
            if (startAlpha === 0 && endAlpha > 0) {
                startColor =
                    ((startColor & 0xff000000) | (endColor & 0x00ffffff)) >>> 0;
            }
            else if (endAlpha === 0 && startAlpha > 0) {
                endColor = ((endColor & 0xff000000) | (startColor & 0x00ffffff)) >>> 0;
            }
            const gradient = this.context.createLinearGradient(tx, ty, endX, endY);
            gradient.addColorStop(0, normalizeCanvasColor(startColor));
            gradient.addColorStop(1, normalizeCanvasColor(endColor));
            this.context.fillStyle = gradient;
            this.context.fillRect(tx, ty, width, height);
        }
        else {
            this.context.fillStyle = normalizeCanvasColor(color);
            this.context.fillRect(tx, ty, width, height);
        }
    }
    /**
     * Renders a node's content (texture or color rect) into an arbitrary 2D
     * context instead of the main canvas. Used by shaders that need to
     * composite the node's content offscreen (e.g. EdgeFade alpha masks).
     *
     * The content is drawn at the node's global position — the caller is
     * responsible for setting a transform on `target` that maps it to the
     * desired location.
     */
    renderNodeContent(node, target) {
        let texture = node.props.texture;
        if (node.placeholderActive === true || texture === null) {
            texture = this.stage.defaultTexture;
        }
        const prev = this.context;
        this.context = target;
        this.renderContext(node, texture);
        this.context = prev;
    }
    createShaderNode(shaderKey, shaderType, props) {
        return new CanvasShaderNode(shaderKey, shaderType, this.stage, props);
    }
    createShaderProgram(_shaderConfig) {
        return null;
    }
    supportsShaderType(shaderType) {
        return shaderType.render !== undefined;
    }
    createCtxTexture(textureSource) {
        return new CanvasTexture(this.stage.txMemManager, textureSource);
    }
    getBufferInfo() {
        return null;
    }
    getQuadCount() {
        return null;
    }
    getRenderOpCount() {
        return null;
    }
    getCapabilities() {
        return {
            renderMode: 'canvas',
            webGlVersion: null,
            vertexArrayObject: false,
            maxTextureSize: 0,
            maxTextureUnits: 0,
        };
    }
    // Canvas2D has no GPU out-of-memory signal to probe.
    checkForOutOfMemory() {
        return false;
    }
    /**
     * Updates the clear color of the canvas renderer.
     *
     * @param color - The color to set as the clear color.
     */
    updateClearColor(color) {
        this.clearColor = normalizeCanvasColor(color);
        this.clearColorAlpha = (color >>> 24) & 0xff;
    }
    getTextureCoords(node) {
        const texture = node.texture;
        if (texture === null) {
            return undefined;
        }
        const ctxTexture = texture.type === TextureType.subTexture
            ? texture.parentTexture.ctxTexture
            : texture.ctxTexture;
        if (ctxTexture === undefined) {
            return undefined;
        }
        const textureOptions = node.props.textureOptions;
        // early exit for textures with no options unless its a subtexture
        if (texture.type !== TextureType.subTexture &&
            textureOptions === undefined) {
            return { x1: 0, y1: 0, x2: 1, y2: 1 };
        }
        // Fresh object: the result is stored on the node.
        return resolveUvRect(node, texture, 0, 0, 1, 1, {
            x1: 0,
            y1: 0,
            x2: 1,
            y2: 1,
        });
    }
    getDefaultShaderNode() {
        return null;
    }
}
//# sourceMappingURL=CanvasRenderer.js.map