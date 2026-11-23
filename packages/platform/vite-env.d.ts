/// <reference types="vite/client" />

declare global {
  /** Whether the DOM renderer should be used instead of `@solid-multiplatform/renderer` */
  var SOLIDTV_DOM_RENDERING: boolean | undefined;
  /** Whether element shaders should be disabled */
  var SOLIDTV_DISABLE_SHADERS: boolean | undefined;
  /**
   * Whether this target's bundle carries the touch scroller: `true` on
   * pointer/touch targets, `false` on the televisions (see
   * `TOUCH_SCROLL_COMPILED` in `src/primitives/utils/touchScroll.ts`, the
   * one list of television targets). Undefined keeps the runtime decision.
   */
  var SOLIDTV_TOUCH_SCROLL: boolean | undefined;
}

interface ImportMetaEnv {
  readonly __DEV__: boolean;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export {};
