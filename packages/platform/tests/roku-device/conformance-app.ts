// Runs the scene conformance cases on a real Roku against the SceneGraph
// backend and reports each result on the device console, where
// run-conformance.mjs reads it. Built with the Roku example's toolchain.
import { createElement, insertNode } from '@roku-sdk/solid';
import type { SceneNode } from '@solid-multiplatform/renderer/contracts';
import { sceneConformance } from '@solid-multiplatform/renderer/conformance';
import { SceneGraphRenderer } from '@solid-multiplatform/renderer/roku';

// Every timer the backend arms while the suite runs, for the idle case.
let scheduled = 0;
const timeout = globalThis.setTimeout;
globalThis.setTimeout = ((handler: () => void, ms?: number) => {
  scheduled++;
  return timeout(handler, ms);
}) as typeof globalThis.setTimeout;

async function run(root: object): Promise<void> {
  let passed = 0;
  let failed = 0;
  const cases = sceneConformance({
    create() {
      const group = createElement('group');
      insertNode(root as never, group as never);
      return new SceneGraphRenderer({}, group);
    },
    settle: () => new Promise((resolve) => timeout(resolve, 50)),
    childrenOf: (node) =>
      (node as unknown as { children: SceneNode[] }).children,
    scheduled: () => scheduled,
  });
  for (const c of cases) {
    try {
      await c.run();
      passed++;
      console.log('CONFORMANCE PASS ' + c.name);
    } catch (error) {
      failed++;
      console.log(
        'CONFORMANCE FAIL ' +
          c.name +
          ' :: ' +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }
  console.log(`CONFORMANCE DONE passed=${passed} failed=${failed}`);
}

/** The Roku host calls this with its root group once the scene exists. */
export function mount(host: { root: object }): () => void {
  void run(host.root);
  return () => {};
}
