import type { Renderer } from '../Renderer.js';
/** What `auditFrame` takes; every key has a default. */
export interface FrameAuditOptions {
    /**
     * The overdraw grid's cell size, in logical px: a cell counts a quad
     * when the quad covers its centre.
     *
     * @defaultValue 8
     */
    cellSize: number;
    /**
     * A quad covering at least this share of the viewport (after its clip)
     * is listed as a full-screen layer.
     *
     * @defaultValue 0.9
     */
    fullScreen: number;
}
/**
 * Why an op did not extend the one before it: a key that differs (all of
 * them, in this order), `perOp` when every key matched and a per-op
 * uniform split them (`perOpMatch`), or `chunk` for the first op of a
 * chunk after a full stream was flushed.
 */
export type BatchKey = 'program' | 'params' | 'texture' | 'clip' | 'perOp' | 'chunk';
/** A node, named so that a person can find it. */
export interface AuditNode {
    /** Store slot (`node.id`). */
    id: number;
    /** `node.uid`, as the DOM inspector keys its elements. */
    uid: number;
    /**
     * The path from the root, one `name[childIndex]` per level (the
     * componentName, else `node` or `text`), then `#uid`, the text, the
     * image (`src=`, or `sub=` for a SubTexture of that sheet) and `data`.
     */
    label: string;
    /** The path without child indices: what the copies of a component share. */
    path: string;
    /** `data`'s strings, numbers and booleans (the inspector's data-* attributes). */
    data: Record<string, string | number | boolean> | null;
}
/**
 * The texture record an op binds (a SubTexture's quads bind their sheet's).
 * Id 0, kind `none`, is no record: the backend's white texture, which a
 * colour quad draws with, and so does an image not uploaded yet.
 */
export interface AuditTexture {
    id: number;
    kind: 'none' | 'image' | 'color' | 'noise' | 'subTexture';
    src: string | null;
    w: number;
    h: number;
}
/** A clip record's logical rect. */
export interface AuditClip {
    id: number;
    x: number;
    y: number;
    w: number;
    h: number;
}
/** One drawn op: one drawElements. */
export interface AuditOp {
    index: number;
    /** The chunk it was drawn in: 0, or more when a full stream flushed mid-walk. */
    chunk: number;
    /** The program's name: `Default`, `Sdf`, or the shader type's. */
    program: string;
    /** Equal numbers are the same params block (one batch key); null for none. */
    params: number | null;
    texture: AuditTexture;
    clip: AuditClip | null;
    quads: number;
    /** The node of its first quad (`OpList.node`): the one that started it. */
    node: AuditNode;
    /** Its quads are glyphs. */
    text: boolean;
    /** Null for the frame's first op. */
    break: BatchKey[] | null;
    /**
     * GL calls it issued, its drawElements included: measured with the
     * context spy (`glCallsMeasured`), else estimated from the keys that
     * changed (per-op uniforms not counted).
     */
    glCalls: number;
}
/** A quad that covers (nearly) the whole viewport: a full pass of fill. */
export interface AuditLayer {
    op: number;
    node: AuditNode;
    /** The share of the viewport it covers, 0 to 1. */
    coverage: number;
}
/**
 * The emitted quads' bounding rects (after their clip) rasterized into a
 * grid of `cellSize` px cells: how many quads each cell is shaded by. A
 * grown quad (a border or shadow outside the node) counts its node's rect
 * only, so this is a lower bound there.
 */
export interface AuditOverdraw {
    cellSize: number;
    cols: number;
    rows: number;
    /** Layers per cell over the viewport: the frame's fill in screens. */
    mean: number;
    max: number;
    fullScreen: AuditLayer[];
}
export type FindingKind = 'transparent-shader' | 'ztext-flush' | 'split-run' | 'separate-textures';
/**
 * Batch breaks a scene change could avoid, grouped by kind, culprit path
 * and detail. `glCalls` is what merging would save: the culprit op's calls
 * plus, when it splits a run, those of the op that restarts the run.
 */
export interface AuditFinding {
    kind: FindingKind;
    detail: string;
    /** The culprits' path without child indices. */
    path: string;
    count: number;
    glCalls: number;
    /** The culprit ops, by index. */
    ops: number[];
    /** The first culprit's label. */
    example: string;
}
/** One drawn frame: what it drew, and why it batched the way it did. */
export interface FrameAuditReport {
    /** The frame's time (`renderer.currentFrameTime`). */
    time: number;
    viewport: {
        w: number;
        h: number;
        pixelRatio: number;
    };
    /** Draws: 1, plus one per full stream flushed mid-walk. */
    chunks: number;
    /** Scene walks of the frame's update (re-walks for mid-frame writes). */
    walks: number;
    /** The renderer's count of the frame's ops, as telemetry's `renderUpdate` reports it. */
    renderOps: number;
    /** Quads drawn, glyphs included. */
    quads: number;
    /** Vertex bytes written for upload (the stream's cursor x 4, per chunk). */
    uploadBytes: number;
    scene: {
        visited: number;
        updated: number;
        emitted: number;
        textEmitted: number;
    };
    /** GL calls by method during the draw, from the context spy; null without `enableContextSpy`. */
    glCalls: Record<string, number> | null;
    /** The ops' `glCalls` were measured (the context spy is on), not estimated. */
    glCallsMeasured: boolean;
    /** Ops by the first key that broke them from the op before. */
    breaks: Record<BatchKey, number>;
    overdraw: AuditOverdraw;
    /** Most GL calls first. */
    findings: AuditFinding[];
    ops: AuditOp[];
}
/**
 * Capture the next drawn frame (a frame is requested, so a static scene
 * draws one): its ops as drawn, which key broke each batch, GL calls (by
 * method with `enableContextSpy`), upload bytes, scene counters, overdraw
 * and the breaks a scene change could avoid. A development tool: it wraps
 * the backend's frame start and draw, the op list's adds and, with the
 * spy, the context's upload and draw, for that one frame only, so a
 * renderer that never calls it pays nothing. The capture is built inside
 * the frame, which is slower for it.
 */
export declare function auditFrame(renderer: Renderer, options?: Partial<FrameAuditOptions>): Promise<FrameAuditReport>;
/** The report as console lines: totals, breaks, overdraw, then the findings. */
export declare function formatFrameAudit(report: FrameAuditReport, top?: number): string;
/** Log `formatFrameAudit(report)` to the console. */
export declare function printFrameAudit(report: FrameAuditReport, top?: number): void;
