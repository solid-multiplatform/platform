/**
 * The scene contract: what the platform's ElementNode, layout, focus and
 * primitives may use of a drawing backend. WebGL, Canvas 2D, Roku SceneGraph
 * and the DOM test backend each satisfy it (see `<backend>/contract.check.ts`),
 * and a new backend only has to satisfy it too.
 *
 * It is types plus one constant table. The platform holds the backend's node
 * object directly and writes its properties, so the contract adds no call or
 * allocation to a frame.
 */

/** `SceneNode.renderState` values. */
export const RenderState = {
  Init: 0,
  OutOfBounds: 2,
  InBounds: 4,
  InViewport: 8,
} as const;
export type RenderStateValue = (typeof RenderState)[keyof typeof RenderState];

/**
 * A node's position, size, color, transform and source. All are writable.
 * `Self` is the backend's own node type: a node's parent is always a node of
 * the same backend.
 */
export interface SceneNodeProps<Self = SceneNode> {
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
  color: number;
  colorTop: number;
  colorBottom: number;
  colorLeft: number;
  colorRight: number;
  colorTl: number;
  colorTr: number;
  colorBl: number;
  colorBr: number;
  scale: number | null;
  scaleX: number;
  scaleY: number;
  rotation: number;
  mount: number;
  mountX: number;
  mountY: number;
  pivot: number;
  pivotX: number;
  pivotY: number;
  /** Paint order among siblings; ties paint in child order. */
  zIndex: number;
  /** Clip children to this node's box, or to `[x, y, w, h]` inside it. */
  clipping: boolean | [number, number, number, number];
  autosize: boolean;
  rtl?: boolean | null;
  ignoreParentAlpha: boolean;
  /** Color drawn while `src`/`texture` is loading. */
  placeholderColor: number;
  /**
   * Image URL; `null` clears it. The platform writes URLs only. A backend may
   * also accept decoded image data (Canvas takes a Blob or ImageData).
   */
  src: string | object | null;
  texture: SceneTexture | null;
  textureOptions: object;
  /** Sub-rectangle of the source image. */
  srcX?: number;
  srcY?: number;
  srcWidth?: number;
  srcHeight?: number;
  imageType?: string | null;
  /** A shader from `createShader`, or a backend-specific effects object. */
  shader: object | null;
  /** Free-form data the backend may surface in its inspector. */
  data: Record<string, unknown> | null;
  parent: Self | null;
}

/** The props only a text node has. */
export interface SceneTextLayoutProps {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontStyle: string;
  fontStretch?: string;
  lineHeight: number | undefined;
  letterSpacing: number;
  textAlign: string;
  verticalAlign: string;
  /** `none`, `width` or `both`: which of `maxWidth`/`maxHeight` bound layout. */
  contain: string;
  maxWidth: number;
  maxHeight: number;
  maxLines: number;
  overflowSuffix: string;
  wordBreak: string;
  offsetY: number;
  forceLoad: boolean;
}

/** Every prop of a text node. */
export interface SceneTextProps<Self = SceneNode>
  extends SceneNodeProps<Self>, SceneTextLayoutProps {}

/** The numeric props `animate` and `animateProp` accept. */
export type SceneAnimatableProps = Partial<
  Pick<
    SceneNodeProps,
    | 'x'
    | 'y'
    | 'w'
    | 'h'
    | 'alpha'
    | 'color'
    | 'colorTop'
    | 'colorBottom'
    | 'colorLeft'
    | 'colorRight'
    | 'colorTl'
    | 'colorTr'
    | 'colorBl'
    | 'colorBr'
    | 'scaleX'
    | 'scaleY'
    | 'rotation'
    | 'mountX'
    | 'mountY'
    | 'pivotX'
    | 'pivotY'
    | 'zIndex'
  > & { scale: number; mount: number; pivot: number }
>;

export interface SceneAnimationSettings {
  duration: number;
  delay: number;
  /** An easing name, or a function from progress to eased progress. */
  easing: string | ((progress: number) => number);
  loop: boolean;
  repeat: number;
  repeatDelay: number;
  stopMethod: 'reverse' | false;
}

export interface SceneAnimationController {
  start(): SceneAnimationController;
  stop(): SceneAnimationController;
  pause(): SceneAnimationController;
  /** Puts the animated props back to their values from before the run. */
  restore(): SceneAnimationController;
  /** Resolves when the current run stops, naturally or through `stop()`. */
  waitUntilStopped(): Promise<void>;
  readonly state: 'scheduled' | 'running' | 'paused' | 'stopped';
}

/**
 * Node events. `loaded` and `failed` report the node's image or text;
 * the viewport events follow `renderState`.
 */
export type SceneNodeEvent =
  | 'loaded'
  | 'failed'
  | 'freed'
  | 'inBounds'
  | 'outOfBounds'
  | 'inViewport'
  | 'outOfViewport';

export type SceneListener = (target: any, data: any) => void;

export interface SceneNode extends SceneNodeProps {
  /** The shader in effect; reading always gives a shader instance. */
  shader: SceneShader | null;
  /** Position in root coordinates after every ancestor's translation. */
  readonly absX: number;
  readonly absY: number;
  readonly renderState: number;
  /**
   * Inserts `child` before `before` in paint order, or appends it when
   * `before` is null. A child that is already a child is moved.
   */
  insertBefore(child: SceneNode, before: SceneNode | null): void;
  animate(
    props: SceneAnimatableProps,
    settings: Partial<SceneAnimationSettings>,
  ): SceneAnimationController;
  /** Animates one numeric prop; replaces a running animation of that prop. */
  animateProp(
    name: string,
    value: number,
    settings: Partial<SceneAnimationSettings>,
  ): SceneAnimationController;
  on(event: string, listener: SceneListener): void;
  once(event: string, listener: SceneListener): void;
  off(event: string, listener?: SceneListener): void;
  destroy(): void;
}

export interface SceneTextNode extends SceneNode, SceneTextLayoutProps {}

/** A shader instance. `props` is live: writing a prop redraws the node. */
export interface SceneShader {
  readonly shaderType: unknown;
  props?: Record<string, any>;
}

/** A texture from `createTexture`, assignable to `SceneNodeProps.texture`. */
export interface SceneTexture {
  on?(event: string, listener: SceneListener): void;
  once?(event: string, listener: SceneListener): void;
}

/**
 * The effect kinds every backend understands. Props are the flat bag the
 * platform builds from `border`, `borderRadius`, `shadow` and the gradient
 * props (`radius`, `border-w`, `border-color`, `shadow-x`, `colors`, ...).
 * A backend may accept further kinds of its own.
 */
export type SceneEffectKind =
  | 'rounded'
  | 'roundedWithBorder'
  | 'roundedWithShadow'
  | 'roundedWithBorderWithShadow'
  | 'linearGradient'
  | 'radialGradient';

export type SceneTextureKind = 'ImageTexture' | 'SubTexture';

/**
 * What `loadFont` takes. Beyond the family name the options belong to the
 * backend: an SDF atlas for WebGL, a font file URL for Canvas and Roku.
 */
export interface SceneFont {
  fontFamily: string;
  [option: string]: unknown;
}

/** Renderer events. `idle` fires when a frame ends with nothing left to draw. */
export type SceneRendererEvent = 'idle' | 'fpsUpdate' | 'frameTick';

export interface SceneRenderer<
  Node extends SceneNode = SceneNode,
  TextNode extends SceneTextNode = SceneTextNode,
> {
  readonly root: Node;
  createNode(props?: Partial<SceneNodeProps<Node>>): Node;
  createTextNode(props?: Partial<SceneTextProps<Node>>): TextNode;
  /** Null when the backend has no shader of that kind. */
  createShader(
    kind: SceneEffectKind | (string & {}),
    props?: Record<string, any>,
  ): SceneShader | null;
  createTexture(
    kind: SceneTextureKind | (string & {}),
    props: Record<string, any>,
  ): SceneTexture;
  /**
   * Registers a {@link SceneFont}. Text using the family draws once it has
   * loaded. Typed loosely because each backend checks its own options.
   */
  loadFont(font: any): unknown;
  on(event: SceneRendererEvent | (string & {}), listener: SceneListener): void;
  /** Schedules a frame. Backends draw only when something changed. */
  requestRender(): void;
  destroy(): void;

  /** Runs `callback` after the pending node updates were applied this frame. */
  reprocessUpdates?(callback: () => void): void;
  /** Resizes the drawing surface; logical scene coordinates are unchanged. */
  resize?(width: number, height: number, pixelRatio?: number): void;
  pause?(options?: { immediate?: boolean }): void;
  resume?(): void;
  memoryInfo?(): unknown;
}

/** @deprecated Use {@link SceneNode}. */
export type HostNode = Pick<SceneNode, 'parent' | 'destroy'>;
/**
 * @deprecated Use {@link SceneRenderer}. The earlier, partial shape, kept
 * while the platform moves to the full contract.
 */
export interface HostRenderer<
  Node extends HostNode = HostNode,
  Shader = unknown,
  Texture = unknown,
> {
  readonly root: Node;
  createNode(props: Record<string, unknown>): Node;
  createTextNode(props: Record<string, unknown>): Node;
  createShader(kind: string, props: Record<string, unknown>): Shader;
  createTexture(kind: string, props: Record<string, unknown>): Texture;
  on(event: 'idle', callback: () => void): void;
  readonly stage: {
    loadFont(kind: string, options: object): unknown;
    reprocessUpdates?(callback: () => void): void;
  };
}
