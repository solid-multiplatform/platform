// The accessibility test's app: a handful of semantics nodes registered
// with the host's sink, as primitives will. run.mjs is the assistive
// technology: it reads the tree from the accessibility bus and asks for the
// actions; this prints what reached it (`ACTION …`).
//
// Pressing Play renames it to Pause, mutes, moves the focus to the switch
// and removes the Next button, in one batch, which run.mjs then reads back
// while this watches the loop stay idle.
import { launchDesktop } from '@solid-multiplatform/host-desktop';
import type { Semantics } from '@solid-multiplatform/platform/semantics';

const IDLE_MS = 3000;
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
const at = (x: number, y: number, width: number, height: number) => () => ({
  x,
  y,
  width,
  height,
});

async function idle(): Promise<void> {
  // The batch goes out in a microtask; this starts after it.
  await sleep(300);
  console.log('UPDATED');
  const start = __solid.stats();
  await sleep(IDLE_MS);
  const end = __solid.stats();
  console.log(
    'IDLE ' +
      JSON.stringify({
        ms: IDLE_MS,
        wakeups: end.wakeups - start.wakeups,
        frames: end.frames - start.frames,
        presents: end.presents - start.presents,
      }),
  );
}

launchDesktop({ title: 'Solid a11y test' }, (context) => {
  const sink = context.semantics;
  const native = __solid.a11y;
  if (sink === undefined || native === undefined) {
    console.log('ABSENT');
    __solid.exit(3);
    return () => {};
  }
  // Nothing has been described yet: nothing may have been asked for.
  const before = native.active();

  const group = sink.register({
    role: 'group',
    label: 'Player controls',
    bounds: at(0, 0, 400, 200),
  });
  sink.register(
    {
      role: 'heading',
      label: 'Now playing',
      level: 1,
      bounds: at(0, 0, 400, 40),
    },
    group,
  );
  const play: Semantics = {
    role: 'button',
    label: 'Play',
    description: 'Starts the film',
    bounds: at(10, 50, 100, 40),
    activate: () => pressed(),
    focus: () => console.log('ACTION focus play'),
  };
  const playHandle = sink.register(play, group);
  const mute: Semantics = {
    role: 'switch',
    label: 'Mute',
    checked: false,
    bounds: at(120, 50, 100, 40),
    activate: () => console.log('ACTION click mute'),
    focus: () => console.log('ACTION focus mute'),
  };
  const muteHandle = sink.register(mute, group);
  sink.register(
    {
      role: 'slider',
      label: 'Volume',
      value: '7',
      min: 0,
      max: 10,
      now: 7,
      bounds: at(230, 50, 160, 40),
    },
    group,
  );
  const next = sink.register(
    {
      role: 'button',
      label: 'Next',
      disabled: true,
      bounds: at(10, 100, 100, 40),
      // Disabled: neither may ever be called.
      activate: () => console.log('ACTION click next'),
      focus: () => console.log('ACTION focus next'),
    },
    group,
  );
  playHandle.focus?.();

  function pressed(): void {
    console.log('ACTION click play');
    playHandle.update({ ...play, label: 'Pause', description: undefined });
    muteHandle.update({ ...mute, checked: true });
    muteHandle.focus?.();
    next.dispose();
    void idle();
  }

  void (async () => {
    // The batch has gone out and the adapter has asked the session bus:
    // no assistive technology runs yet, so nothing may have been built.
    await sleep(500);
    console.log(
      'REGISTERED ' + JSON.stringify({ before, active: native.active() }),
    );
    // run.mjs switches accessibility on; the adapter hears of it and only
    // then asks for the tree.
    for (let waited = 0; !native.active() && waited < 8000; waited += 50) {
      await sleep(50);
    }
    console.log('READY ' + JSON.stringify({ active: native.active() }));
  })();
  return () => console.log('DISPOSED');
});
