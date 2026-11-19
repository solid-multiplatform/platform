// Contract tests: the public types apps augment, and the type-only export
// names of every entry point.
//
// Type-level only: never executed, not a vitest file. `pnpm tsc` checks it
// through tests/tsconfig.contract.json. A failure here is a type error.
import type {
  ElementNode,
  IntrinsicNodeStyleProps,
  IntrinsicTextNodeStyleProps,
  KeyMap,
  NodeStyles,
  TextStyles,
} from '@solid-multiplatform/platform';
import { useFocusManager } from '@solid-multiplatform/platform/primitives';
import type { KeyMap as PrimitivesKeyMap } from '@solid-multiplatform/platform/primitives';

// --- Types: augmentable with `declare module "@solid-multiplatform/platform"` -------------
//
// Each augmentation adds a member with a precise type, then uses it both ways:
// a valid use, and an invalid one under @ts-expect-error. The index
// signatures on ElementNode, NodeProps and KeyMap would accept the valid use
// even without the augmentation; the invalid one only fails if it merged.

declare module '@solid-multiplatform/platform' {
  // demo app LeftNavWrapper.tsx, announcer.ts
  interface ElementNode {
    contractItem?: { href: string };
  }
  interface NodeProps {
    contractNodeProp?: number;
  }
  interface NodeStyles {
    contractNodeStyle?: number;
  }
  interface TextStyles {
    contractTextStyle?: number;
  }
  // demo app styles.ts: app-specific states
  interface IntrinsicNodeStyleProps {
    contractActive?: IntrinsicNodeStyleProps;
  }
  interface IntrinsicTextNodeStyleProps {
    contractActive?: IntrinsicTextNodeStyleProps;
  }
  // demo app LeftNavWrapper.tsx: custom keys, required like the demo's
  interface KeyMap {
    ContractMenu: (string | number)[];
  }
}

export function elementNodeAugmentation(el: ElementNode) {
  const href: string | undefined = el.contractItem?.href;
  // @ts-expect-error -- contractItem.href is a string
  const wrong: number | undefined = el.contractItem?.href;
  // An ElementNode member is also a JSX prop.
  const ok = <view contractItem={{ href: 'x' }} />;
  // @ts-expect-error -- contractItem.href is a string
  const bad = <view contractItem={{ href: 1 }} />;
  return [href, wrong, ok, bad];
}

export function nodePropsAugmentation() {
  const ok = <view contractNodeProp={1} />;
  // @ts-expect-error -- contractNodeProp is a number
  const bad = <view contractNodeProp="1" />;
  return [ok, bad];
}

export function nodeStylesAugmentation() {
  const style: NodeStyles = { contractNodeStyle: 1, alpha: 0.5 };
  // @ts-expect-error -- contractNodeStyle is a number
  const bad: NodeStyles = { contractNodeStyle: '1' };
  const inJsx = <view style={{ contractNodeStyle: 1 }} />;
  return [style, bad, inJsx];
}

export function textStylesAugmentation() {
  const style: TextStyles = { contractTextStyle: 1, fontSize: 20 };
  // @ts-expect-error -- contractTextStyle is a number
  const bad: TextStyles = { contractTextStyle: '1' };
  const inJsx = <text style={{ contractTextStyle: 1 }}>x</text>;
  return [style, bad, inJsx];
}

export function intrinsicStylePropsAugmentation() {
  const node = {
    alpha: 1,
    contractActive: { alpha: 0.5 },
  } satisfies IntrinsicNodeStyleProps;
  const text = {
    fontSize: 20,
    contractActive: { fontSize: 30 },
  } satisfies IntrinsicTextNodeStyleProps;
  // @ts-expect-error -- contractActive is a style object
  const bad: IntrinsicNodeStyleProps = { contractActive: 1 };
  // @ts-expect-error -- contractActive is a style object
  const badText: IntrinsicTextNodeStyleProps = { contractActive: 1 };
  return [node, text, bad, badText];
}

export function keyMapAugmentation() {
  useFocusManager({ ContractMenu: ['m', 77], Left: ['ArrowLeft', 37] });
  const keyMap = {
    Left: 'ArrowLeft',
    Right: 'ArrowRight',
    Up: 'ArrowUp',
    Down: 'ArrowDown',
    Enter: 'Enter',
    Last: null,
    ContractMenu: ['m'],
  } satisfies KeyMap;
  // @ts-expect-error -- the augmented member is required
  const missing: KeyMap = {
    Left: null,
    Right: null,
    Up: null,
    Down: null,
    Enter: null,
    Last: null,
  };
  // @ts-expect-error -- the index signature allows null, ContractMenu does not
  const nullMenu: KeyMap['ContractMenu'] = null;
  // The primitives entry exports the same, augmented KeyMap.
  const viaPrimitives: PrimitivesKeyMap['ContractMenu'] = ['m'];
  // @ts-expect-error -- the index signature allows null, ContractMenu does not
  const nullViaPrimitives: PrimitivesKeyMap['ContractMenu'] = null;
  return [keyMap, missing, nullMenu, viaPrimitives, nullViaPrimitives];
}

// --- Types that state what the runtime does ---------------------------------

export function effectsTypes() {
  // A border's thickness is `width`, with `w` as its alias, as on `border`.
  const width: import('@solid-multiplatform/platform').Effects = {
    border: { width: 2, color: 0xff0000ff },
    borderTop: { width: 1 },
    linearGradient: { colors: [0xff0000ff, 0x0000ffff] },
  };
  const w: import('@solid-multiplatform/platform').Effects = {
    border: { w: 2 },
  };
  const hole: import('@solid-multiplatform/platform').Effects = {
    // @ts-expect-error -- effects does not forward holePunch: use `shader`
    holePunch: { width: 10 },
  };
  return [width, w, hole];
}

export function navigableScroll() {
  const bounded: import('@solid-multiplatform/platform/primitives').NavigableProps['scroll'] =
    'bounded';
  return bounded;
}

export function hashRouterProps() {
  const ok: import('@solid-multiplatform/platform/primitives/router').HashRouterProps =
    { forceProxy: true, queryParams: ['id'] };
  const bad: import('@solid-multiplatform/platform/primitives/router').HashRouterProps =
    {
      // @ts-expect-error -- HashRouter never read explicitLinks
      explicitLinks: true,
    };
  return [ok, bad];
}

export function keyHandlerArguments() {
  const handler: import('@solid-multiplatform/platform').KeyHandler = function (
    e,
    handlerElm,
    focusedElm,
    mappedEvent,
  ) {
    const self: ElementNode = handlerElm;
    const leaf: ElementNode = focusedElm;
    const name: string | undefined = mappedEvent;
    return self === this && leaf !== undefined && name === e.key;
  };
  return handler;
}

// --- SDK port shapes a native host can implement ----------------------------

type Platform = typeof import('@solid-multiplatform/platform');
type PlatformTypes = {
  DeviceInfo: import('@solid-multiplatform/platform').DeviceInfo;
  ShareOptions: import('@solid-multiplatform/platform').ShareOptions;
  MediaActionHandlers: import('@solid-multiplatform/platform').MediaActionHandlers;
  Recording: import('@solid-multiplatform/platform').Recording;
  MicrophonePort: import('@solid-multiplatform/platform').MicrophonePort;
  ContactQuery: import('@solid-multiplatform/platform').ContactQuery;
  ContactPage: import('@solid-multiplatform/platform').ContactPage;
  AudioPort: import('@solid-multiplatform/platform').AudioPort;
  LocalePort: import('@solid-multiplatform/platform').LocalePort;
};

export function sdkPortShapes(blob: Blob) {
  const desktop: PlatformTypes['DeviceInfo'] = {
    platform: 'desktop',
    os: 'linux',
    arch: 'x64',
  };
  // An operating system outside the listed ones is still a string.
  const other: PlatformTypes['DeviceInfo'] = { platform: 'tv', os: 'vidaa' };
  const share: PlatformTypes['ShareOptions'] = {
    files: [{ path: '/cache/a.pdf' }, { blob, name: 'a.txt' }],
  };
  const actions: PlatformTypes['MediaActionHandlers'] = {
    seekto: (details) => details.seekTime.toFixed(1),
    pause: () => {},
  };
  // A native recording is a file: no browser type is needed.
  const recording: PlatformTypes['Recording'] = {
    mimeType: 'audio/mp4',
    path: '/cache/a.m4a',
  };
  const microphone: PlatformTypes['MicrophonePort'] = {
    start: async () => ({ stop: async () => recording }),
  };
  const query: PlatformTypes['ContactQuery'] = { limit: 20, after: 'cursor' };
  const page: PlatformTypes['ContactPage'] = { contacts: [], next: 'cursor' };
  const audio: Pick<PlatformTypes['AudioPort'], 'subscribe'> = {
    subscribe(listener) {
      listener('interrupted');
      // @ts-expect-error -- not a playback state
      listener('buffering');
      return () => {};
    },
  };
  const locale: Pick<PlatformTypes['LocalePort'], 'subscribe'> = {
    subscribe: (listener) => () => listener(),
  };
  const start: Platform['startRecording'] = async () => microphone.start({});
  return [desktop, other, share, actions, query, page, audio, locale, start];
}

// --- Exports: type-only names ----------------------------------------------
//
// Every type-only export of each entry point today. Importing a name that is
// gone is a type error. (Runtime names are pinned in publicApi.test.ts.)

// @solid-multiplatform/platform: Solid's own types (82). Six of them, the Shader*Props
// names and WebGlShader, are re-exported by src/core/shaders.ts as aliases
// of @solid-multiplatform/renderer types (the renderer does not export these names, so
// they are not in the next list).
export type {
  AddColorString,
  AnimationEventHandler,
  AnimationEvents,
  AnimationSettings,
  BorderRadius,
  BorderStyle,
  BorderStyleObject,
  CoreShaderManager,
  DefaultKeyMap,
  DollarString,
  DomRendererMainSettings,
  Effects,
  ElementText,
  EventHandlers,
  ExtractProps,
  FocusNode,
  FontLoadOptions,
  ForwardFocusHandler,
  IEventEmitter,
  IRendererCoreRenderer,
  IRendererFontManager,
  IRendererMain,
  IRendererNode,
  IRendererNodeProps,
  IRendererNodeShaded,
  IRendererShader,
  IRendererShaderManager,
  IRendererShaderProps,
  IRendererShaderType,
  IRendererStage,
  IRendererTextNode,
  IRendererTextNodeProps,
  IntrinsicNodeProps,
  IntrinsicNodeStyleProps,
  IntrinsicTextNodeStyleProps,
  JSX,
  KeyEventLike,
  KeyEventTarget,
  KeyHandler,
  KeyHandlerReturn,
  KeyMap,
  KeyNameOrKeyCode,
  NewOmit,
  NodeProps,
  NodeStyles,
  NodeTypes,
  OnEvent,
  Rect,
  RemoveUnderscoreProps,
  RenderedNode,
  RendererNode,
  SdfFontType,
  ShaderBorderPrefixedProps,
  ShaderBorderProps,
  ShaderHolePunch,
  ShaderHolePunchProps,
  ShaderLinearGradient,
  ShaderLinearGradientProps,
  ShaderRadialGradient,
  ShaderRadialGradientProps,
  ShaderRounded,
  ShaderRoundedProps,
  ShaderRoundedWithBorder,
  ShaderRoundedWithBorderAndShadow,
  ShaderRoundedWithBorderAndShadowProps,
  ShaderRoundedWithBorderProps,
  ShaderRoundedWithShadow,
  ShaderRoundedWithShadowProps,
  ShaderShadow,
  ShaderShadowPrefixedProps,
  ShaderShadowProps,
  SingleBorderStyle,
  SingleBorderStyleObject,
  SolidNode,
  SolidRendererOptions,
  SolidStyles,
  StyleEffects,
  Styles,
  TextProps,
  TextStyles,
  Vec4,
  WebGlShader,
} from '@solid-multiplatform/platform';

// @solid-multiplatform/platform: the renderer's names, via `export type * from
// '@solid-multiplatform/renderer'` in src/core/index.ts: 103 on the installed
// @solid-multiplatform/renderer 2.0 (AnimationSettings, FontLoadOptions, IEventEmitter,
// TextNode and TextProps are Solid's own). Some are values in the renderer
// but type-only here. A renderer-side rename or removal is a break inherited
// from the renderer.
export type {
  AdvancedProp,
  AnimateProps,
  AnimationControllerState,
  BlurProps,
  BorderProps,
  BoundsMargin,
  ClippingValue,
  ColorTexture,
  ColorTextureProps,
  CoreNodeRenderState,
  CoreSettings,
  Dimensions,
  EdgeFadeProps,
  EventEmitter,
  FRAME_TIME_BUCKET_COUNT,
  FRAME_TIME_COARSE_MS,
  FRAME_TIME_FINE_MS,
  FRAME_TIME_MAX_MS,
  FRAME_TIME_SPLIT_MS,
  FontMetrics,
  FontPrefetchOptions,
  FpsUpdatePayload,
  FrameTickPayload,
  HolePunchProps,
  IAnimationController,
  INode,
  INodeProps,
  ITextNode,
  ITextNodeProps,
  ImageTexture,
  ImageTextureProps,
  ImageType,
  Inspector,
  InspectorOptions,
  LinearGradientProps,
  MemoryInfo,
  Node,
  NodeFailedEventHandler,
  NodeFailedPayload,
  NodeLoadedEventHandler,
  NodeLoadedPayload,
  NodeRenderableEventHandler,
  NodeRenderablePayload,
  NodeTextFailedPayload,
  NodeTextLoadedPayload,
  NodeTextureFailedPayload,
  NodeTextureFreedPayload,
  NodeTextureLoadedPayload,
  NodeViewportPayload,
  NoiseTexture,
  NoiseTextureProps,
  PassHooks,
  Platform,
  PlatformConstructor,
  RadialGradientProps,
  RadialProgressProps,
  RenderStateValue,
  RenderUpdatePayload,
  Renderer,
  RendererCapabilities,
  RendererCore,
  RendererMain,
  RendererMainSettings,
  RendererRuntimeSettings,
  RendererSettings,
  RoundedProps,
  RoundedWithBorderAndShadowProps,
  RoundedWithBorderProps,
  RoundedWithShadowProps,
  ShaderClock,
  ShaderContext,
  ShaderNode,
  ShaderSource,
  ShaderType,
  ShadowProps,
  SubTexture,
  SubTextureProps,
  TextAlign,
  TextBaselineMode,
  TextContain,
  TextFontStyle,
  TextVerticalAlign,
  TextWordBreak,
  Texture,
  TextureError,
  TextureErrorCode,
  TextureMap,
  TextureMemorySettings,
  TextureOptions,
  TextureResizeMode,
  TextureState,
  TextureType,
  TimingFunction,
  UniformWriter,
  UpdateNode,
  Viewport,
  WebGlShaderType,
  clearFontPrefetch,
  frameTimeBucketIndex,
  frameTimeBucketLowerBound,
  isTextureError,
  normalizeBoundsMargin,
  prefetchFont,
} from '@solid-multiplatform/platform';

// @solid-multiplatform/platform/primitives (28).
export type {
  AnyFunction,
  ColumnProps,
  FocusHistoryEntry,
  GridItemProps,
  GridProps,
  HoldCallback,
  HoldHandler,
  ImageProps,
  KeyEventLike as PrimitivesKeyEventLike,
  KeyEventTarget as PrimitivesKeyEventTarget,
  KeyHandler as PrimitivesKeyHandler,
  KeyMap as PrimitivesKeyMap,
  MarqueeAnimationProps,
  MarqueeControlProps,
  MarqueeProps,
  MarqueeTextProps,
  NavigableElement,
  NavigableProps,
  NavigableStyleProperties,
  OnSelectedChanged,
  RowProps,
  ScrollableElement,
  Scroller,
  SpeechType,
  SpriteDef,
  UseHoldProps,
  VirtualGridProps,
  VirtualProps,
} from '@solid-multiplatform/platform/primitives';

// @solid-multiplatform/platform/primitives/router (3).
export type {
  Branch,
  HashRouterProps,
  KeepAliveElement,
} from '@solid-multiplatform/platform/primitives/router';

// @solid-multiplatform/platform/devtools (1).
export type { HexColorTransformOptions } from '@solid-multiplatform/platform/devtools';
