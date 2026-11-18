// The Canvas 2D backend against the shared scene conformance cases.
import { test } from 'vitest';
import {
  CanvasRenderer,
  CanvasTextRenderer,
  RendererMain,
} from '@solid-multiplatform/renderer/canvas';
import type { SceneNode } from '@solid-multiplatform/renderer/contracts';
import { sceneConformance } from '@solid-multiplatform/renderer/conformance';
import { scheduled, settle, target } from './conformance-harness';

for (const c of sceneConformance({
  create: () =>
    new RendererMain(
      {
        appWidth: 1920,
        appHeight: 1080,
        numImageWorkers: 0,
        renderEngine: CanvasRenderer,
        fontEngines: [CanvasTextRenderer],
      },
      target(),
    ),
  settle,
  childrenOf: (node) => (node as unknown as { children: SceneNode[] }).children,
  scheduled,
}))
  test('Canvas backend: ' + c.name, c.run);
