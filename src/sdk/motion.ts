import { viewport } from './viewport.js';

interface Controller {
  start(): unknown;
  stop(): unknown;
}
interface AnimatedNode {
  animate(props: Record<string, number>, settings: object): Controller;
}
const running = new WeakMap<object, Map<string, Controller>>();
/** Retarget from the current value. Stop only the tracks owned by this call on cleanup. */
export function transition(
  node: AnimatedNode,
  props: Record<string, number>,
  options: { duration?: number; easing?: string } = {},
) {
  let tracks = running.get(node);
  if (!tracks) {
    tracks = new Map();
    running.set(node, tracks);
  }
  const owned = new Map<string, Controller>();
  const immediate = viewport().reducedMotion || options.duration === 0;
  for (const [name, value] of Object.entries(props)) {
    const old = tracks.get(name);
    old?.stop();
    tracks.delete(name);
    if (immediate) {
      Reflect.set(node, name, value);
      continue;
    }
    const track = node.animate(
      { [name]: value },
      {
        duration: options.duration ?? 180,
        easing: options.easing ?? 'ease-out',
      },
    );
    tracks.set(name, track);
    owned.set(name, track);
    track.start();
  }
  return () => {
    for (const [key, track] of owned)
      if (tracks.get(key) === track) {
        track.stop();
        tracks.delete(key);
      }
  };
}
