// The Roku SceneGraph backend, on the in-browser fake of the Roku SDK, against
// the shared scene conformance cases.
import { test } from 'vitest';
import { SceneGraphRenderer } from '@solid-multiplatform/renderer/roku';
import type { SceneNode } from '@solid-multiplatform/renderer/contracts';
import { sceneConformance } from '@solid-multiplatform/renderer/conformance';
import { scheduled, settle } from './conformance-harness';
import { createElement } from './scenegraph-sdk/nodes';

for (const c of sceneConformance({
  create: () => new SceneGraphRenderer({}, createElement('group')),
  settle,
  childrenOf: (node) => (node as unknown as { children: SceneNode[] }).children,
  scheduled,
}))
  test('SceneGraph backend: ' + c.name, c.run);
