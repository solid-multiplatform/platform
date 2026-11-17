import type { ShaderType } from '../ShaderType.js';
export interface RoundedProps {
    radius: number | number[];
    'top-left': number;
    'top-right': number;
    'bottom-right': number;
    'bottom-left': number;
}
export interface BorderProps {
    w: number | number[];
    color: number;
    align: number | 'inside' | 'center' | 'outside';
    gap: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
}
export interface ShadowProps {
    color: number;
    projection: number | number[];
    x: number;
    y: number;
    blur: number;
    spread: number;
}
type Prefixed<T, P extends string> = {
    [K in keyof T as `${P}-${string & K}`]: T[K];
};
export type RoundedWithBorderProps = RoundedProps & Prefixed<BorderProps, 'border'> & {
    'border-fill': number;
};
export type RoundedWithShadowProps = RoundedProps & Prefixed<ShadowProps, 'shadow'>;
export type RoundedWithBorderAndShadowProps = RoundedProps & Prefixed<BorderProps, 'border'> & Prefixed<ShadowProps, 'shadow'>;
export declare const Rounded: ShaderType<RoundedProps>;
export declare const Border: ShaderType<BorderProps>;
export declare const RoundedWithBorder: ShaderType<RoundedWithBorderProps>;
export declare const RoundedWithShadow: ShaderType<RoundedWithShadowProps>;
export declare const Shadow: ShaderType<ShadowProps>;
export declare const RoundedWithBorderAndShadow: ShaderType<RoundedWithBorderAndShadowProps>;
export {};
