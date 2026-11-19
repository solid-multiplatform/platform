// The connectivity service, in a run without a window, on a bus of
// run.mjs's own with its stand-in for NetworkManager on it. Prints what the
// service says as it changes (`ONLINE true`, `CHANGED false`, …); run.mjs
// makes the stand-in go offline and back.
import {
  installServices,
  loadService,
  serviceAvailable,
} from '@solid-multiplatform/platform/services';
import { desktopServices } from '../../src/services/manifest';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function run(): Promise<void> {
  installServices(desktopServices({ id: 'solid.test.network' }));
  if (serviceAvailable('connectivity') !== 'available') {
    console.log('ABSENT');
    __solid.exit(0);
    return;
  }
  const connectivity = await loadService('connectivity');
  let changes = 0;
  const stop = connectivity.subscribe((online) => {
    changes++;
    console.log(`CHANGED ${online} ${connectivity.online()}`);
    if (changes === 2) void finish();
  });
  console.log(`ONLINE ${connectivity.online()}`);

  async function finish(): Promise<void> {
    stop();
    // Subscribed to nothing and nothing changing: the loop sleeps.
    await sleep(300);
    const before = __solid.stats().wakeups;
    await sleep(1500);
    console.log(`IDLE ${__solid.stats().wakeups - before}`);
    __solid.exit(0);
  }
}

run().catch((error) => {
  console.error(error);
  __solid.exit(1);
});
