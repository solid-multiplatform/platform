import { test } from 'vitest';
import { Config } from '@solid-multiplatform/platform';
import { FONT_FAMILY } from './setup';
import { verifySharedFixture } from './shared-fixture';
test('WebGL mounts, updates, reorders, focuses and disposes shared JSX', async () => {
  document.body.innerHTML = '<div id="app"></div>';
  Config.fontSettings = { fontFamily: FONT_FAMILY, fontSize: 30 };
  await verifySharedFixture();
});
