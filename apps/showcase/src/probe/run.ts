/**
 * Probe mode: every unattended service probe, then the UI assertions the app
 * can check from inside, then one JSON document through the host's reporter.
 *
 * The UI assertions press keys on the host's key target (see `keys.ts`) and
 * read the scene's own focus. The waits below are timers, and only run during
 * a probe: once the result is reported nothing is scheduled.
 */
import { createSignal } from 'solid-js';
import {
  activeElement,
  useCapabilities,
  type ElementNode,
} from '@solid-multiplatform/platform';
import { installedServices } from '@solid-multiplatform/platform/services';
import type { Showcase } from '../env';
import { LIST_SIZE } from '../screens/List';
import { runAllUnattended } from '../services/run';
import { probeHooks } from './hooks';
import {
  failed,
  ok,
  unverified,
  type Outcome,
  type ProbeResult,
} from './result';

const [probeStatus, setProbeStatus] = createSignal('');
/** A line for the home screen: empty outside probe mode. */
export { probeStatus };

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) return false;
    await wait(20);
  }
  return true;
}

function inside(node: ElementNode | undefined, root: ElementNode | undefined) {
  if (root === undefined) return false;
  for (let at = node; at; at = at.parent) if (at === root) return true;
  return false;
}

/** Opens a section and waits until its own autofocus has landed. */
async function open(showcase: Showcase, path: string, ready: () => boolean) {
  const before = activeElement();
  showcase.go(path);
  if (!(await until(() => ready() && activeElement() !== before)))
    throw new Error(`${path} did not take focus`);
}

async function home(showcase: Showcase) {
  const before = activeElement();
  if (showcase.back()) await until(() => activeElement() !== before);
}

/**
 * A key, then a turn of the event loop: the scene applies a focus change
 * after the key's handlers have run, not inside them.
 */
type Press = (key: string) => Promise<void>;

async function focusMoves(press: Press): Promise<Outcome> {
  if (!(await until(() => activeElement() !== undefined)))
    return failed('nothing has focus on the home screen');
  const first = activeElement();
  let there = 'ArrowRight';
  let back = 'ArrowLeft';
  await press(there);
  if (activeElement() === first) {
    // One tile to a row on a narrow screen.
    there = 'ArrowDown';
    back = 'ArrowUp';
    await press(there);
  }
  if (activeElement() === first) return failed('an arrow key moved nothing');
  await press(back);
  return activeElement() === first
    ? ok(`${there} then ${back} returned to the first tile`)
    : failed(`${back} did not return to the first tile`);
}

async function listScrolls(showcase: Showcase, press: Press): Promise<Outcome> {
  const STEPS = 25;
  await open(showcase, '/list', () => probeHooks.list !== undefined);
  try {
    const list = probeHooks.list!;
    // Back button, then the list's first row.
    await press('ArrowDown');
    if (!(await until(() => inside(activeElement(), list), 1000)))
      return failed('Down did not enter the list');
    for (let step = 0; step < STEPS; step++) await press('ArrowDown');
    const reached = await until(() => probeHooks.listIndex?.() === STEPS, 1000);
    const index = probeHooks.listIndex?.();
    const focused = (activeElement() as { item?: number } | undefined)?.item;
    const mounted = list.children.length;
    if (!reached || focused !== STEPS)
      return failed(
        `after ${STEPS} Down keys the list is at ${index}, focus at ${focused}`,
      );
    if (mounted >= LIST_SIZE)
      return failed(`all ${mounted} rows are mounted: not virtual`);
    return ok(`row ${STEPS + 1} focused, ${mounted} of ${LIST_SIZE} mounted`);
  } finally {
    await home(showcase);
  }
}

async function modalTraps(showcase: Showcase, press: Press): Promise<Outcome> {
  await open(showcase, '/dialogs', () => probeHooks.modalOpener !== undefined);
  try {
    const opener = probeHooks.modalOpener!;
    await press('ArrowDown');
    if (activeElement() !== opener)
      return failed('Down did not reach the button that opens the modal');
    await press('Enter');
    const entered = await until(
      () => inside(activeElement(), probeHooks.modal),
      1000,
    );
    if (!entered) return failed('focus did not move into the modal');
    for (const key of [
      'ArrowUp',
      'ArrowUp',
      'ArrowLeft',
      'ArrowRight',
      'ArrowDown',
      'ArrowDown',
      'ArrowDown',
    ]) {
      await press(key);
      if (!inside(activeElement(), probeHooks.modal))
        return failed(`${key} took focus out of the modal`);
    }
    await press('Backspace');
    if (!(await until(() => probeHooks.modalOpen?.() === false, 1000)))
      return failed('Back did not close the modal');
    if (!(await until(() => activeElement() === opener, 1000)))
      return failed('focus did not return to the button that opened it');
    return ok('7 arrow keys stayed inside; Back closed it and restored focus');
  } finally {
    await home(showcase);
  }
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

async function uiAssertions(
  showcase: Showcase,
): Promise<Record<string, Outcome>> {
  const raise = showcase.env.pressKey;
  const press: Press = async (key) => {
    raise?.(key);
    await wait(0);
  };
  const names = ['focusMovesWithKeys', 'virtualListScrolls', 'modalTrapsFocus'];
  if (raise === undefined)
    return Object.fromEntries(
      names.map((name) => [
        name,
        unverified('this host entry raises no synthetic keys'),
      ]),
    );
  const checks: Record<string, () => Promise<Outcome>> = {
    focusMovesWithKeys: () => focusMoves(press),
    virtualListScrolls: () => listScrolls(showcase, press),
    modalTrapsFocus: () => modalTraps(showcase, press),
  };
  const results: Record<string, Outcome> = {};
  for (const name of names) {
    try {
      results[name] = await checks[name]!();
    } catch (error) {
      results[name] = failed(message(error));
    }
  }
  return results;
}

export async function runProbeMode(showcase: Showcase): Promise<void> {
  setProbeStatus('Probe running.');
  const services = await runAllUnattended();
  const ui = await uiAssertions(showcase);
  const result: ProbeResult = {
    target: showcase.env.target,
    backend: showcase.env.backend,
    capabilities: useCapabilities(),
    installedServices: installedServices(),
    services,
    ui,
  };
  setProbeStatus('Probe done.');
  showcase.env.report(result);
}
