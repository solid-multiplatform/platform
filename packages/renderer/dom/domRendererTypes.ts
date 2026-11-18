import type * as lng from '../webgl/exports/index.js';
import type { EventEmitter } from '../webgl/exports/utils.js';

type ShaderHolePunchProps = lng.HolePunchProps;
type ShaderLinearGradientProps = lng.LinearGradientProps;
type ShaderRadialGradientProps = lng.RadialGradientProps;
type ShaderRoundedProps = lng.RoundedProps;
interface ShaderBorderProps extends lng.BorderProps {
  gap: number;
  inset: boolean;
}
type ShaderBorderPrefixedProps = {
  [P in keyof ShaderBorderProps as `border-${P}`]: ShaderBorderProps[P];
};
type ShaderShadowPrefixedProps = {
  [P in keyof lng.ShadowProps as `shadow-${P}`]: lng.ShadowProps[P];
};

/** A web font for the DOM backend: one file under one or more family names. */
export interface DomFontLoadOptions {
  fontFamily: string | string[];
  fontUrl?: string;
  [option: string]: unknown;
}

/** Based on {@link lng.CoreRenderer} */
export interface IRendererCoreRenderer {
  mode: 'canvas' | 'webgl' | undefined;
  boundsMargin?: number | [number, number, number, number];
}
/** Based on {@link lng.TrFontManager} */
export interface IRendererFontManager {
  addFontFace: (...a: any[]) => void;
}
/** Based on {@link lng.Stage} */
export interface IRendererStage {
  root: IRendererNode;
  renderer: IRendererCoreRenderer;
  shManager: IRendererShaderManager;
  animationManager: {
    registerAnimation: (anim: any) => void;
    unregisterAnimation: (anim: any) => void;
  };
  loadFont: lng.RendererMain['loadFont'];
  reprocessUpdates?: (callback?: () => void) => void;
  requestRender: () => void;
  cleanup(full: boolean): void;
}

/** Based on {@link lng.CoreShaderManager} */
export interface IRendererShaderManager {
  registerShaderType: (name: string, shader: any) => void;
}

/** Based on {@link lng.CoreShaderType} */
export interface IRendererShaderType {}

export type IRendererShaderProps = Partial<ShaderBorderPrefixedProps> &
  Partial<ShaderShadowPrefixedProps> &
  Partial<ShaderRoundedProps> &
  Partial<ShaderHolePunchProps> &
  Partial<ShaderRadialGradientProps> &
  Partial<ShaderLinearGradientProps>;

/** Based on {@link lng.ShaderNode} */
export interface IRendererShader extends Partial<lng.ShaderType> {
  shaderType: IRendererShaderType;
  props?: IRendererShaderProps;
  program?: {};
}

export type ExtractProps<Type> = Type extends { z$__type__Props: infer Props }
  ? Props
  : never;

export interface IEventEmitter<
  T extends object = { [s: string]: (target: any, data: any) => void },
> {
  on<K extends keyof T>(event: Extract<K, string>, listener: T[K]): void;
  once<K extends keyof T>(event: Extract<K, string>, listener: T[K]): void;
  off<K extends keyof T>(event: Extract<K, string>, listener: T[K]): void;
  emit<K extends keyof T>(
    event: Extract<K, string>,
    data: Parameters<any>[1],
  ): void;
}

export interface IRendererNodeShaded extends EventEmitter {
  stage: IRendererStage;
  id: number;
  animate: (
    props: Partial<lng.AnimateProps>,
    settings: Partial<lng.AnimationSettings>,
  ) => lng.IAnimationController;
  /** One prop, started at once. */
  animateProp(
    name: string,
    value: number,
    settings: Partial<lng.AnimationSettings>,
  ): lng.IAnimationController;
  /** Places `child` before `before` in paint order, or last when null. */
  insertBefore(child: IRendererNode, before: IRendererNode | null): void;
  destroy(): void;
  get absX(): number;
  get absY(): number;
}

/** Based on {@link lng.INodeProps} */
export interface IRendererNodeProps extends Omit<
  lng.INodeProps,
  'shader' | 'parent'
> {
  shader: IRendererShader | null;
  parent: IRendererNode | null;
}

/** Based on {@link lng.CoreNode} */
export interface IRendererNode extends IRendererNodeShaded, IRendererNodeProps {
  div?: HTMLElement;
  props: IRendererNodeProps;
  renderState: lng.CoreNodeRenderState;
}

/** Based on {@link lng.ITextNodeProps} */
export interface IRendererTextNodeProps extends Omit<
  lng.ITextNodeProps,
  'shader' | 'parent'
> {
  shader: IRendererShader | null;
  parent: IRendererNode | null;
  fontWeight?: string;
  fontStretch?: string;
}

/** Based on {@link lng.ITextNode} */
export interface IRendererTextNode
  extends IRendererNodeShaded, IRendererTextNodeProps {
  div?: HTMLElement;
  props: IRendererTextNodeProps;
  renderState: lng.CoreNodeRenderState;
}

/** Based on {@link lng.RendererMain} */
export interface IRendererMain extends IEventEmitter {
  root: IRendererNode;
  stage: IRendererStage;
  canvas: HTMLCanvasElement;
  createTextNode(props: Partial<IRendererTextNodeProps>): IRendererTextNode;
  createNode(props: Partial<IRendererNodeProps>): IRendererNode;
  createShader: typeof lng.RendererMain.prototype.createShader;
  createTexture: typeof lng.RendererMain.prototype.createTexture;
}

export interface DomRendererMainSettings {
  /**
   * The logical width of the application (default: 1920)
   */
  appWidth?: number;

  /**
   * The logical height of the application (default: 1080)
   */
  appHeight?: number;

  /**
   * Device logical pixel ratio (default: 1)
   */
  deviceLogicalPixelRatio?: number;

  /**
   * Preload margin around the viewport, in logical pixels (default: 200)
   *
   * @remarks
   * A single number applied to all sides, or a per-side
   * `[top, right, bottom, left]` tuple.
   */
  boundsMargin?: number | [number, number, number, number];
}
