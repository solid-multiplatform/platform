// The services that live on the session bus, in a run without a window.
// run.mjs starts this twice on a bus of its own: with its stand-in for the
// notification service, and without. Prints one line of JSON.
import {
  installServices,
  loadService,
  serviceAvailable,
} from '@solid-multiplatform/platform/services';
import { desktopServices } from '../../src/services/manifest';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function run(): Promise<void> {
  const started = performance.now();
  installServices(desktopServices({ id: 'solid.test.services' }));
  const installMs = performance.now() - started;
  const available = serviceAvailable('notifications');
  const report: Record<string, unknown> = { available, installMs };
  if (available === 'available') {
    const notifications = await loadService('notifications');
    report.permission = [
      await notifications.permission(),
      await notifications.request(),
    ];
    await notifications.show({ title: 'First', body: 'héllo "wörld"' });
    await notifications.show({ id: 'download', title: 'Downloading' });
    // The same id: it takes the place of the one before.
    await notifications.show({ id: 'download', title: 'Downloaded' });
    // Nothing waits on the bus afterwards.
    await sleep(700);
    const before = __solid.stats().wakeups;
    await sleep(1500);
    report.idleWakeups = __solid.stats().wakeups - before;
  } else {
    report.rejects = await loadService('notifications').then(
      () => 'resolved',
      (error: Error) => `${error.name}: ${error.message}`,
    );
  }
  console.log('SERVICES ' + JSON.stringify(report));
  __solid.exit(0);
}

run().catch((error) => {
  console.error(error);
  __solid.exit(1);
});
