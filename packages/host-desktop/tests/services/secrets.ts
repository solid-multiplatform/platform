// The `secureStorage` service in a run without a window. run.mjs starts this
// on a bus of its own: once with a stand-in for the Secret Service, once
// without, and once with it locked. Prints one line of JSON. Values are
// compared inside and reported as booleans; nothing here prints a secret.
import {
  installServices,
  loadService,
  serviceAvailable,
} from '@solid-multiplatform/platform/services';
import { desktopServices } from '../../src/services/manifest';

const APP = 'solid.test.services';
// The values run.mjs also knows, so that it can look for them in the
// stand-in's file.
const TOKEN = 'plain-secret-value';
const REPLACED = 'plain-secret-value-replaced';
const ODD_KEY = 'odd key !@#$%^&*() é';
const ODD_VALUE = 'välue with spaces and "quotes"';

async function run(): Promise<void> {
  const mode = __solid.args[0] ?? 'check';
  const started = performance.now();
  installServices(desktopServices({ id: APP }));
  const installMs = performance.now() - started;
  const available = serviceAvailable('secureStorage');
  const report: Record<string, unknown> = { mode, available, installMs };

  if (mode === 'check') {
    if (available !== 'available') {
      report.rejects = await loadService('secureStorage').then(
        () => 'resolved',
        (error: Error) => `${error.name}: ${error.message}`,
      );
    }
  } else if (mode === 'locked') {
    const store = await loadService('secureStorage');
    try {
      await store.set('token', TOKEN);
      report.error = null;
    } catch (error) {
      report.error = error instanceof Error ? error.message : String(error);
    }
  } else {
    const store = await loadService('secureStorage');
    report.missing = (await store.get('never-written')) === null;
    await store.set('token', TOKEN);
    report.roundTrip = (await store.get('token')) === TOKEN;
    await store.set('token', REPLACED);
    report.overwritten = (await store.get('token')) === REPLACED;
    await store.set(ODD_KEY, ODD_VALUE);
    report.oddKey = (await store.get(ODD_KEY)) === ODD_VALUE;
    await store.remove('token');
    report.removed = (await store.get('token')) === null;
    await store.remove(ODD_KEY);
    // Removing a key that is not there succeeds.
    await store.remove('never-written');
  }

  console.log('SECRETS ' + JSON.stringify(report));
  __solid.exit(0);
}

run().catch((error) => {
  console.error(error);
  __solid.exit(1);
});
