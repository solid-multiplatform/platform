import type { ShaderType } from '../ShaderType.js';
export interface BlurProps {
    /** Blur amount in node px (small values, 1 to 8, look best). */
    amount: number;
}
/**
 * A single-pass 3x3 Gaussian approximation (1.10 Blur): nine texture
 * fetches, no render target. Row 0: the tap offset in texture space.
 */
export declare const Blur: ShaderType<BlurProps>;
