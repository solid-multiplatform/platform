import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingAndroidDriver } from '../android-driver.mjs';
import { NativePlayer } from '../native.mjs';

function harness() {
  const allocations = [];
  const p = new NativePlayer('android-tv', 'media3', () =>
    pendingAndroidDriver(
      (ready, failed) => {
        const request = {
          ready,
          failed,
          canceled: 0,
          cancel() {
            this.canceled++;
          },
        };
        allocations.push(request);
        return request;
      },
      (engine) => engine,
    ),
  );
  return { p, allocations };
}
const source = { url: 'test:movie', kind: 'vod', paused: true };
// A late engine is released in a macrotask so a blocking Media3 teardown never
// runs inside the input frame that delivered it.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('stop cancels allocation and pending operations; a late engine is released once', async () => {
  const { p, allocations } = harness();
  const open = assert.rejects(p.open(source), { code: 'invalid-state' });
  const command = assert.rejects(p.setVolume(0.5), { code: 'invalid-state' });
  await p.stop();
  await Promise.all([open, command]);
  let released = 0;
  allocations[0].ready({
    release() {
      released++;
    },
  });
  assert.equal(released, 0, 'release must not run inside the delivery frame');
  await tick();
  await p.dispose();
  assert.equal(allocations[0].canceled, 1);
  assert.equal(released, 1);
});

test('replacement attaches only its own engine and preserves queued commands', async () => {
  const { p, allocations } = harness();
  const previous = assert.rejects(p.open(source), { code: 'invalid-state' });
  const open = p.open({ ...source, url: 'test:next' });
  const command = p.setVolume(0.25);
  const calls = [];
  allocations[0].ready({
    release() {
      calls.push('release-old');
    },
  });
  allocations[1].ready({
    prepare(url) {
      calls.push(url);
    },
    pause() {
      calls.push('pause');
    },
    setVolume(volume) {
      calls.push(volume);
    },
    dispose() {
      calls.push('dispose');
    },
  });
  await Promise.all([previous, open, command]);
  await tick();
  assert.deepEqual(calls, ['test:next', 0.25, 'pause', 'release-old']);
  await p.dispose();
  await p.dispose();
  assert.equal(calls.filter((s) => s === 'dispose').length, 1);
});

test('timeout cancels the native request and releases a late result', async () => {
  const { p, allocations } = harness();
  await assert.rejects(p.open({ ...source, startupBudgetMs: 10 }), {
    code: 'prepare-failed',
  });
  let released = false;
  allocations[0].ready({
    release() {
      released = true;
    },
  });
  assert.equal(allocations[0].canceled, 1);
  assert.equal(released, false, 'release must be deferred out of this frame');
  await tick();
  assert.equal(released, true);
});

test('a failed view binding releases the engine and surfaces the original failure', async () => {
  let deliver;
  const d = pendingAndroidDriver(
    (ready) => {
      deliver = ready;
      return { cancel() {} };
    },
    () => {
      throw Error('view unavailable');
    },
  );
  const result = assert.rejects(d.prepare('test:movie'), /view unavailable/);
  let released = 0;
  deliver({
    release() {
      released++;
    },
  });
  await result;
  d.dispose();
  assert.equal(released, 1);
});

test('disposing from the opening notification does not allocate a driver', async () => {
  const { p, allocations } = harness();
  p.subscribe((s) => {
    if (s.state === 'opening') void p.dispose();
  });
  await assert.rejects(p.open(source), { code: 'invalid-state' });
  assert.equal(p.snapshot.state, 'disposed');
  assert.equal(allocations.length, 0);
});

test('disposing from the ready notification does not call the released player', async () => {
  const { p, allocations } = harness();
  p.subscribe((s) => {
    if (s.state === 'ready') void p.dispose();
  });
  const open = assert.rejects(p.open({ ...source, paused: false }), {
    code: 'invalid-state',
  });
  let plays = 0,
    disposals = 0;
  allocations[0].ready({
    prepare() {},
    play() {
      plays++;
    },
    dispose() {
      disposals++;
    },
  });
  await open;
  assert.equal(plays, 0);
  assert.equal(disposals, 1);
});

test('an error handler can start a replacement session', async () => {
  const { p, allocations } = harness();
  let replacement;
  p.subscribe((s) => {
    if (s.state === 'error') replacement = p.open(source);
  });
  const original = assert.rejects(p.open(source), { code: 'prepare-failed' });
  allocations[0].failed('could not create engine');
  await original;
  allocations[1].ready({ prepare() {}, pause() {}, dispose() {} });
  await replacement;
  assert.equal(p.snapshot.state, 'paused');
  await p.dispose();
});

test('a driver abandoned before prepare does not schedule native work', () => {
  let calls = 0;
  const d = pendingAndroidDriver(
    () => {
      calls++;
    },
    () => {
      throw Error('unreachable');
    },
  );
  d.dispose();
  assert.throws(() => d.prepare('test:movie'), { code: 'invalid-state' });
  assert.equal(calls, 0);
});

test('disposing after binding but before queued prepare does not call a released engine', async () => {
  let deliver;
  const d = pendingAndroidDriver(
    (ready) => {
      deliver = ready;
      return { cancel() {} };
    },
    (engine) => engine,
  );
  const pending = assert.rejects(d.prepare('test:movie'), {
    code: 'invalid-state',
  });
  let prepared = 0,
    released = 0;
  deliver(
    {
      prepare() {
        prepared++;
      },
      dispose() {
        released++;
      },
    },
    {},
  );
  d.dispose();
  await pending;
  assert.equal(prepared, 0);
  assert.equal(released, 1);
});

test('a view binding that triggers disposal cannot install its driver afterward', async () => {
  let deliver,
    releases = 0;
  const d = pendingAndroidDriver(
    (ready) => {
      deliver = ready;
      return { cancel() {} };
    },
    () => {
      d.dispose();
      return {
        dispose() {
          releases++;
        },
      };
    },
  );
  const opening = assert.rejects(d.prepare('test:movie'), {
    code: 'invalid-state',
  });
  deliver(
    {
      release() {
        throw Error('driver owns this engine');
      },
    },
    {},
  );
  await opening;
  assert.equal(releases, 1);
});
