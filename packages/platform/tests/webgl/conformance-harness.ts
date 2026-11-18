// Shared pieces of the browser conformance runs (WebGL, Canvas, SceneGraph).
let scheduledCallbacks = 0;
const raf = window.requestAnimationFrame.bind(window);
const timeout = window.setTimeout.bind(window);
window.requestAnimationFrame = (callback) => {
  scheduledCallbacks++;
  return raf(callback);
};
window.setTimeout = ((
  handler: TimerHandler,
  ms?: number,
  ...args: unknown[]
) => {
  scheduledCallbacks++;
  return timeout(handler, ms, ...args);
}) as typeof window.setTimeout;

/** Frame and timer callbacks requested so far, by anyone on the page. */
export const scheduled = () => scheduledCallbacks;

/** Two animation frames, each followed by a macrotask. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 2; i++)
    await new Promise<void>((resolve) => raf(() => timeout(resolve, 0)));
}

export function target(): HTMLElement {
  return document.body.appendChild(document.createElement('div'));
}
