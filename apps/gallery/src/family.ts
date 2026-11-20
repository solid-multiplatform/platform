import { supports, useCapabilities } from '@solid-multiplatform/platform';

/**
 * The UI family the app is running as — not the target's name. The same
 * build can be a phone app, a ten-foot TV app or a desktop app; the shell,
 * the interaction variants and the guidance follow this.
 */
export type UiFamily = 'mobile' | 'tv' | 'desktop';

/** A coarse pointer with no hover: a phone or a tablet, whatever the target. */
function coarsePointer(): boolean {
  if (typeof matchMedia !== 'function') return false;
  try {
    return matchMedia('(hover: none) and (pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export function uiFamily(): UiFamily {
  const caps = useCapabilities();
  // The console's pointer is a remote: its UI is the television's.
  if (caps.target === 'ps4' || supports('remote')) return 'tv';
  // A native phone reports touch and no mouse; a web build on a phone still
  // lists a mouse in its capabilities, so the pointer media query decides.
  if (supports('touch') && (!supports('mouse') || coarsePointer()))
    return 'mobile';
  // A web build opened with a mouse and a keyboard is a desktop app.
  return 'desktop';
}

/** True when the shell lays out for a ten-foot screen. */
export const isTv = (): boolean => uiFamily() === 'tv';
export const isMobile = (): boolean => uiFamily() === 'mobile';
export const isDesktop = (): boolean => uiFamily() === 'desktop';
