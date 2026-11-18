import { createSignal } from 'solid-js';

export type PlatformTarget =
  | 'web'
  | 'tizen'
  | 'webos'
  | 'vizio'
  | 'roku'
  | 'android'
  | 'android-tv'
  | 'ios'
  | 'apple-tv'
  | 'desktop';

export type InputKind = 'remote' | 'keyboard' | 'mouse' | 'touch' | 'gamepad';

export interface PlatformCapabilities {
  target: PlatformTarget;
  inputs: InputKind[];
  /** Hardware or host support for system-level colour appearance. */
  colorScheme: boolean;
  /** The host can report safe-area/cutout/IME insets. */
  insets: boolean;
  /** The host can produce haptic feedback. */
  haptics: boolean;
}

const defaults: Record<PlatformTarget, PlatformCapabilities> = {
  web: {
    target: 'web',
    inputs: ['keyboard', 'mouse', 'touch'],
    colorScheme: true,
    insets: true,
    haptics: false,
  },
  tizen: {
    target: 'tizen',
    inputs: ['remote'],
    colorScheme: true,
    insets: false,
    haptics: false,
  },
  webos: {
    target: 'webos',
    inputs: ['remote', 'mouse'],
    colorScheme: true,
    insets: false,
    haptics: false,
  },
  vizio: {
    target: 'vizio',
    inputs: ['remote'],
    colorScheme: true,
    insets: false,
    haptics: false,
  },
  roku: {
    target: 'roku',
    inputs: ['remote'],
    colorScheme: true,
    insets: false,
    haptics: false,
  },
  android: {
    target: 'android',
    inputs: ['touch', 'keyboard'],
    colorScheme: true,
    insets: true,
    haptics: true,
  },
  'android-tv': {
    target: 'android-tv',
    inputs: ['remote', 'gamepad'],
    colorScheme: true,
    insets: true,
    haptics: false,
  },
  ios: {
    target: 'ios',
    inputs: ['touch', 'keyboard'],
    colorScheme: true,
    insets: true,
    haptics: true,
  },
  'apple-tv': {
    target: 'apple-tv',
    inputs: ['remote', 'gamepad'],
    colorScheme: true,
    insets: true,
    haptics: false,
  },
  desktop: {
    target: 'desktop',
    inputs: ['keyboard', 'mouse', 'touch'],
    colorScheme: true,
    insets: false,
    haptics: false,
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

export function resetCapabilities(): void {
  setCapabilitiesSignal(defaults.web);
}
