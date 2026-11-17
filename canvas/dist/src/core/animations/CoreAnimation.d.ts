import type { CoreNode, CoreNodeAnimateProps } from '../CoreNode.js';
import { type TimingFunction } from '../utils.js';
import type { AnimationConfig, AnimationManager } from './AnimationManager.js';
export interface AnimationSettings {
    duration: number;
    adaptiveDuration: boolean;
    delay: number;
    easing: string | TimingFunction;
    loop: boolean;
    /**
     * Number of times to play. Not implemented by this renderer's animation
     * manager (WebGL/Canvas play once unless `loop` is set); honoured by
     * solid's DOM renderer, which shares this type.
     */
    repeat: number;
    stopMethod: 'reverse' | false;
}
export declare function createAnimation(manager: AnimationManager, node: CoreNode, props: Partial<CoreNodeAnimateProps>, settings: Partial<AnimationSettings>): AnimationConfig;
