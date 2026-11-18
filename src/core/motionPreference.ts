// Cached on host preference changes; fixed-TV builds never install a listener.
let reduced = false;
export function setMotionPreference(value: boolean) {
  reduced = value;
}
export function wantsReducedMotion() {
  return reduced;
}
