import { test } from 'vitest';
import { useCanvas } from '../../src/hosts/canvas';
import { verifySharedFixture } from './shared-fixture';
test('Canvas mounts, updates, reorders, focuses and disposes shared JSX', async () => {
  document.body.innerHTML = '<div id="app"></div>';
  useCanvas({ appWidth: 640, appHeight: 240, numImageWorkers: 0 });
  await verifySharedFixture();
});
