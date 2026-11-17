import { test } from 'vitest';
import { setRendererFactory } from '@solid-multiplatform/platform';
import { SceneGraphRenderer } from '@solid-multiplatform/renderer/roku';
import { createElement } from './scenegraph-sdk/nodes';
import { verifySharedFixture } from './shared-fixture';
test('SceneGraph mounts, updates, reorders, focuses and disposes shared JSX', async () => {
  const scene = new SceneGraphRenderer({}, createElement('group'));
  setRendererFactory(() => scene);
  try { await verifySharedFixture(); }
  finally { scene.destroy(); setRendererFactory(undefined); }
});
