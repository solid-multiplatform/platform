import type { ShaderType } from '../ShaderType.js';
export interface DashedBorderProps {
    /** Corner radius in px; clamped to half the node's smaller side. */
    radius: number;
    /** Border width in px, drawn inside the node's edge. */
    width: number;
    /** Border colour, 0xRRGGBBAA. */
    color: number;
    /** Dash length in px along the border's centreline. */
    dash: number;
    /** Gap between dashes in px; the pair is stretched to fit the perimeter. */
    gap: number;
}
/**
 * The node's fill clipped to a rounded rectangle, with a dashed border
 * inside its edge. The dashes follow the border's centreline, corners
 * included, and the dash period is stretched so that a whole number of
 * dashes fits the perimeter: the pattern has no seam where it starts. A
 * transparent node draws only the dashes. A `gap` of 0 or less draws a
 * solid border, a `dash` of 0 or less none.
 *
 * The distance along the centreline is branchless (CLAUDE.md: no `if` on
 * anything that varies per fragment): the point folds into the top-right
 * quadrant, where one clamp per side and one `atan` for the corner give
 * the distance from the centre of the nearest side. Pack works out the
 * pattern's phase at each side's centre, so the shader never holds a
 * distance longer than half a side and a corner: in binary16 (mediump on
 * Mali-400) a distance around the whole perimeter steps by a pixel past
 * 1024 px and by 4 past 4096, coarser than the one-pixel dash edge.
 */
export declare const DashedBorder: ShaderType<DashedBorderProps>;
