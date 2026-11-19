/**
 * Window chrome: a host's title bar mode, the window state it reports, and
 * the regions a scene's title bar publishes for hit testing.
 *
 * A host with a window supplies `HostContext.chrome`; targets without one
 * omit it. `native` means the window system draws the title bar, `custom`
 * means the scene does (the window is borderless), and `hidden` means no
 * chrome is drawn at all beyond what the scene asks for. The mode is chosen
 * at startup and is the requested mode: a compositor may still decorate.
 */

export type TitleBarMode = 'native' | 'custom' | 'hidden';

export interface WindowChromeState {
  focused: boolean;
  minimized: boolean;
  maximized: boolean;
  fullscreen: boolean;
  resizable: boolean;
}

export interface WindowChrome {
  readonly os: 'windows' | 'linux' | 'macos';
  /** The requested mode, not proof of what the compositor did. */
  readonly mode: TitleBarMode;
  readonly hitTestInstalled: boolean;
  /** Event-driven: the latest state the window system reported. */
  state(): WindowChromeState;
  /** Booleans mean the window system took the request; events follow. */
  minimize(): boolean;
  toggleMaximized(): boolean;
  setFullscreen(fullscreen: boolean): boolean;
  /** The same path closing the window takes: dispose, then exit. */
  requestClose(): void;
  /** The title-bar menu at a point in scene units, where the system has one. */
  showSystemMenu(x: number, y: number): boolean;
}

/** One measured region of the scene, in scene units. */
export interface ChromeRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** True to drag the window, false for a control inside a drag region. */
  drag: boolean;
}

type RegionSink = (regions: ChromeRegion[]) => void;

let sink: RegionSink | undefined;
const owners = new Map<object, ChromeRegion[]>();
let scheduled = false;

/**
 * Where the regions go. The desktop host sets this while it runs the app;
 * other hosts never do, and the primitives cost nothing there.
 */
export function setChromeRegionSink(next: RegionSink | undefined): void {
  sink = next;
  owners.clear();
}

/**
 * Publishes one owner's regions. Called after layout-affecting turns by the
 * primitives; the batch is coalesced into one native call per turn.
 */
export function setChromeRegions(owner: object, regions: ChromeRegion[]): void {
  owners.set(owner, regions);
  schedule();
}

/** The owner unmounted: its regions are gone at the next batch. */
export function clearChromeRegions(owner: object): void {
  if (!owners.delete(owner)) return;
  schedule();
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  // After the layout microtask that ran the measuring: one call per turn.
  queueMicrotask(() => {
    scheduled = false;
    if (sink === undefined) return;
    const all: ChromeRegion[] = [];
    for (const regions of owners.values()) all.push(...regions);
    sink(all);
  });
}

const stateListeners = new Set<() => void>();

/** The window system reported a new state: `chrome.state()` reads it. */
export function onChromeStateChange(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

/** Called by the host when an event may have changed the window state. */
export function notifyChromeStateChange(): void {
  for (const listener of stateListeners) listener();
}
