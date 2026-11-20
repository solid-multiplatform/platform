import { createSignal } from 'solid-js';

export type PlatformTarget =
  | 'web'
  | 'tizen'
  | 'webos'
  | 'vizio'
  | 'ps4'
  | 'roku'
  | 'android'
  | 'android-tv'
  | 'ios'
  | 'apple-tv'
  | 'desktop';

export type InputKind = 'remote' | 'keyboard' | 'mouse' | 'touch' | 'gamepad';

/**
 * When focus draws its ring:
 *
 * - `always`: every focused element is visible as focused (TVs, where the
 *   remote is the only way to move and a hidden ring would lose the viewer);
 * - `auto`: only after a keyboard or D-pad interaction; a pointer press
 *   focuses without drawing a ring, as `:focus-visible` does on the web;
 * - `never`: focus exists but is never drawn.
 */
export type FocusVisibility = 'always' | 'auto' | 'never';

export interface PlatformCapabilities {
  target: PlatformTarget;
  inputs: InputKind[];
  /** Hardware or host support for system-level colour appearance. */
  colorScheme: boolean;
  /** The host can report safe-area/cutout/IME insets. */
  insets: boolean;
  /** The host can produce haptic feedback. */
  haptics: boolean;
  /** Whether a focused element draws a focus ring (see {@link FocusVisibility}). */
  focusVisibility: FocusVisibility;
}

const defaults: Record<PlatformTarget, PlatformCapabilities> = {
  web: {
    target: 'web',
    inputs: ['keyboard', 'mouse', 'touch'],
    colorScheme: true,
    insets: true,
    haptics: false,
    focusVisibility: 'auto',
  },
  tizen: {
    target: 'tizen',
    inputs: ['remote'],
    colorScheme: true,
    insets: false,
    haptics: false,
    focusVisibility: 'always',
  },
  webos: {
    target: 'webos',
    inputs: ['remote', 'mouse'],
    colorScheme: true,
    insets: false,
    haptics: false,
    focusVisibility: 'always',
  },
  vizio: {
    target: 'vizio',
    inputs: ['remote'],
    colorScheme: true,
    insets: false,
    haptics: false,
    focusVisibility: 'always',
  },
  // The PlayStation 4 browser has a mouse pointer and left click, and no
  // remote, keyboard or gamepad the host can read. A click is Select; pointer
  // movement is focus.
  ps4: {
    target: 'ps4',
    inputs: ['mouse'],
    colorScheme: true,
    insets: false,
    haptics: false,
    focusVisibility: 'always',
  },
  roku: {
    target: 'roku',
    inputs: ['remote'],
    colorScheme: true,
    insets: false,
    haptics: false,
    focusVisibility: 'always',
  },
  android: {
    target: 'android',
    inputs: ['touch', 'keyboard'],
    colorScheme: true,
    insets: true,
    haptics: true,
    focusVisibility: 'auto',
  },
  'android-tv': {
    target: 'android-tv',
    inputs: ['remote', 'gamepad'],
    colorScheme: true,
    insets: true,
    haptics: false,
    focusVisibility: 'always',
  },
  ios: {
    target: 'ios',
    inputs: ['touch', 'keyboard'],
    colorScheme: true,
    insets: true,
    haptics: true,
    focusVisibility: 'auto',
  },
  'apple-tv': {
    target: 'apple-tv',
    inputs: ['remote', 'gamepad'],
    colorScheme: true,
    insets: true,
    haptics: false,
    focusVisibility: 'always',
  },
  desktop: {
    target: 'desktop',
    inputs: ['keyboard', 'mouse', 'touch'],
    colorScheme: true,
    insets: false,
    haptics: false,
    focusVisibility: 'auto',
  },
};

const [capabilities, setCapabilitiesSignal] =
  createSignal<PlatformCapabilities>(defaults.web);

/** The current host's declared capabilities. */
export const useCapabilities = capabilities;

export function setCapabilities(
  target: PlatformTarget,
  patch: Partial<Omit<PlatformCapabilities, 'target'>> = {},
): void {
  setCapabilitiesSignal({ ...defaults[target], ...patch, target });
}

export function supports(input: InputKind): boolean {
  return capabilities().inputs.includes(input);
}

/** True when the app should offer keyboard shortcuts and Tab traversal. */
export function hasKeyboard(): boolean {
  return supports('keyboard');
}

/** True when hover and pointer gestures are meaningful. */
export function hasPointer(): boolean {
  return supports('mouse');
}

/** The current host's focus-ring policy. Reads the capabilities signal. */
export function focusVisibility(): FocusVisibility {
  return capabilities().focusVisibility;
}

export function resetCapabilities(): void {
  setCapabilitiesSignal(defaults.web);
}
