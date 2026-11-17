import type { ShaderType } from '../ShaderType.js';
export interface RadialProgressProps {
    /** Stroke width in px. */
    width: number;
    /** Outer radius in px; 0 fits the node. */
    radius: number;
    /** Filled portion, in [0, 1]. */
    progress: number;
    /** Where the arc starts, in radians (-PI / 2 is 12 o'clock). */
    startAngle: number;
    /** 1 clockwise, -1 counter-clockwise. */
    direction: 1 | -1;
    /**
     * 0xRRGGBBAA colours along the arc, at most 7: 8 take 18 fragment uniform
     * vectors, past the 16 of the GPU floor (7 take 15 rows, and u_alpha and
     * u_time share the 16th; the rules test holds the count).
     */
    colors: number[];
    stops: number[];
    /** The ring under the arc; 0x00000000 draws none. */
    trackColor: number;
    /** End caps: 0 butt, 1 round. */
    cap: 0 | 1;
    /** Above 0, the shader animates one cycle every `duration` ms, looping. */
    duration: number;
    /** While animating: 0 fills, 1 drains. */
    countdown: 0 | 1;
}
/**
 * A ring or arc with a gradient along it (1.10 RadialProgress). With a
 * `duration` it drives its progress from u_time, the progress in the cycle
 * in [0, 1] with `countdown` applied (the stage clock in ms would overflow
 * binary16 on Mali-400 after a minute). Its edges and caps take the
 * one-device-pixel linear edge of the other built-ins (1.10: a smoothstep
 * two logical px wide). Rows (ROWS): U_CENTRE, U_ARC, U_EDGES, U_ANIM,
 * U_TRACK, then the stops. One program per colour count, cap, track and
 * whether a duration animates it.
 */
export declare const RadialProgress: ShaderType<RadialProgressProps>;
