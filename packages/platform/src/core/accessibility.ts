/**
 * The accessibility a node declares in JSX, and the one hook through which a
 * semantics host hears that a node changed. With no host attached the hook is
 * undefined: a change then costs one comparison and nothing else.
 */
import type { ElementNode } from './elementNode.js';

export type SemanticsRole =
  | 'button'
  | 'heading'
  | 'status'
  | 'switch'
  | 'slider'
  | 'group'
  | 'link'
  | 'checkbox'
  | 'radio'
  | 'textbox'
  | 'searchbox'
  | 'dialog'
  | 'alertdialog'
  | 'list'
  | 'listitem'
  | 'menu'
  | 'menuitem'
  | 'tab'
  | 'tabpanel'
  | 'progressbar'
  | 'img'
  | 'separator'
  | 'navigation'
  | 'main'
  | 'tooltip';

/**
 * Accessibility props of `<view>` and `<text>`, named after the ARIA
 * attributes they stand for. A node is exposed to assistive technology when
 * it has a `role`, or an `onEnter` handler (then it is a `button`). Its name
 * is `ariaLabel`, else a string `announce`, else the text drawn inside it.
 */
export interface AccessibilityProps {
  /**
   * What the node is. `none` keeps a node with `onEnter` out of the
   * accessibility tree; its children are still exposed.
   */
  role?: SemanticsRole | 'none';
  /** The accessible name, when the text inside the node is not it. */
  ariaLabel?: string;
  /** A longer description read after the name. */
  ariaDescription?: string;
  /** The value as text: "3 of 10", "Loud". */
  ariaValueText?: string;
  ariaValueNow?: number;
  ariaValueMin?: number;
  ariaValueMax?: number;
  /** Checkboxes, radios and switches. */
  ariaChecked?: boolean;
  /** Tabs, options and rows. */
  ariaSelected?: boolean;
  /** Disclosure buttons and menus. */
  ariaExpanded?: boolean;
  /**
   * The control is shown but cannot be used. A pointer cannot hover, press
   * or activate it and assistive technology reports it as unavailable; key
   * handlers stay the component's own to guard.
   */
  ariaDisabled?: boolean;
  /** Heading level, 1 to 6. */
  ariaLevel?: number;
  /** Announces changes of the node's name without moving focus. */
  ariaLive?: 'polite' | 'assertive';
  /** Hides the node and everything inside it from assistive technology. */
  ariaHidden?: boolean;
}

export const ACCESSIBILITY_PROPS = [
  'role',
  'ariaLabel',
  'ariaDescription',
  'ariaValueText',
  'ariaValueNow',
  'ariaValueMin',
  'ariaValueMax',
  'ariaChecked',
  'ariaSelected',
  'ariaExpanded',
  'ariaDisabled',
  'ariaLevel',
  'ariaLive',
  'ariaHidden',
] as const satisfies ReadonlyArray<keyof AccessibilityProps>;

/**
 * Called with a rendered node whose accessibility may have changed: one of
 * the props above, its text, whether it is visible, or its place in the tree.
 */
export type SemanticsHook = (node: ElementNode) => void;

export let semanticsHook: SemanticsHook | undefined;

/** One semantics host at a time; `undefined` detaches it. */
export function setSemanticsHook(hook: SemanticsHook | undefined): void {
  semanticsHook = hook;
}
