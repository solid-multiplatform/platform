import type { NodeStore } from '../nodes/NodeStore.js';
import type { OpList } from '../gl/OpList.js';
import type { VertexStream } from '../gl/VertexStream.js';
import type { ShaderRegistry } from '../shaders/ShaderRegistry.js';
/**
 * Glyph quads (spec 10.3): PassHooks.emitText, run for each text node the
 * walk queued, in walk order, after the walk or before a quad with a
 * zIndex. Each glyph's four vertices are written into the frame's stream
 * from the node's world transform and the layout's glyph runs (one
 * multiply-add per coordinate for a translate-only node), every drawn frame:
 * nothing is cached between frames. A node's glyphs form one op run keyed
 * by (SDF program, atlas texture, clip record), so the glyphs of
 * consecutive cards on one atlas merge into one op whatever their size or
 * alpha. Stores only: nothing is allocated per frame.
 */
export declare class TextEmitter {
    private readonly nodes;
    private readonly stream;
    private readonly ops;
    private readonly shaders;
    private readonly flush;
    /** The SDF program: -1 until the first glyph, 0 when it failed to compile. */
    private program;
    /** The warm-up tried it: a failure there is not tried again until the first glyph. */
    private warmed;
    constructor(nodes: NodeStore, stream: VertexStream, ops: OpList, shaders: ShaderRegistry, flush: () => void);
    /**
     * The idle warm-up: compile the SDF program before the first glyph needs
     * it, once; false when it was tried already. A failure is not reported
     * and leaves it uncompiled: the first glyph compiles it again and
     * reports that.
     */
    warm(): boolean;
    /**
     * Text node `id`'s glyphs, renderable (laid out, its atlas uploaded):
     * one quad each, in the node's premultiplied colour (white for colour 0,
     * as 1.10 drew `color || 0xffffffff`), with the atlas range at its size
     * as `a_extra`. A full stream is drawn between two glyphs.
     */
    emitText(id: number): void;
}
