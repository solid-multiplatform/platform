// The device test of the Roku video adapter. run-video.mjs serves a clip over
// the LAN, installs this app, and drives it with launch parameters and remote
// keys. It prints:
//   - READY, then OPENED and every state/position/duration the adapter reports;
//   - the firmware's error code and message for an unreachable URL;
//   - the pending timer count after teardown.
// Select draws an opaque bar over the player to prove the Video node is below
// the app's UI. Options disposes the player and reports the timers left.
import {
  createSignal,
  onCleanup,
  onMount,
  Show,
  type JSXElement,
} from 'solid-js';
import { startApp, type HostContext } from '@solid-multiplatform/platform/host';
import { rokuHost, type RokuSurface } from '@solid-multiplatform/platform/roku';
import {
  loadService,
  useService,
} from '@solid-multiplatform/platform/services';
import { createRokuPlayer, type RokuPlayer } from '../../../video/roku.mjs';

const log = (line: string) => console.log('VIDEO ' + line);

// Every timer still pending, counted so teardown can prove it left none.
const timers = new Set<unknown>();
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
globalThis.setTimeout = ((handler: () => void, ms?: number) => {
  const id = realSetTimeout(() => {
    timers.delete(id);
    handler();
  }, ms);
  timers.add(id);
  return id;
}) as typeof setTimeout;
globalThis.clearTimeout = ((id: number) => {
  timers.delete(id);
  return realClearTimeout(id);
}) as typeof clearTimeout;
globalThis.setInterval = ((handler: () => void, ms?: number) => {
  const id = realSetInterval(handler, ms);
  timers.add(id);
  return id;
}) as typeof setInterval;
globalThis.clearInterval = ((id: number) => {
  timers.delete(id);
  return realClearInterval(id);
}) as typeof clearInterval;

function App(context: HostContext<RokuSurface>): JSXElement {
  const [covered, setCovered] = createSignal(false);
  const [line, setLine] = createSignal('waiting');
  let player: RokuPlayer | undefined;

  const show = (text: string) => {
    setLine(text);
    log(text);
  };

  const open = (link: string | null) => {
    // Roku's Hermes has no URL; the link is a small query string.
    const query: Record<string, string> = {};
    for (const pair of (link ?? '').split('?')[1]?.split('&') ?? []) {
      const at = pair.indexOf('=');
      if (at > 0)
        query[decodeURIComponent(pair.slice(0, at))] = decodeURIComponent(
          pair.slice(at + 1),
        );
    }
    const url = query.url;
    const mode = query.mode ?? 'play';
    const start = Number(query.start ?? 0);
    if (!url) {
      show('README no url');
      return;
    }
    // Prove the TV can reach the LAN source independently of the Video node.
    // Prove the TV can reach the source independently of the Video node.
    void (async () => {
      const deadline = new Promise<never>((_, reject) =>
        realSetTimeout(() => reject(new Error('timeout')), 8000),
      );
      try {
        const { fetch: request } = await loadService('request');
        const response = await Promise.race([request(url), deadline]);
        const body = await Promise.race([response.text(), deadline]);
        log(`PROBE status=${response.status} chars=${body.length}`);
      } catch (error) {
        log('PROBE failed ' + String(error).slice(0, 100));
      }
    })();
    player?.dispose();
    player = createRokuPlayer(context.surface, {
      width: 1920,
      height: 1080,
      metadata: { title: 'Roku video test' },
    });
    player.subscribe((snapshot) => {
      const error = snapshot.error;
      show(
        `STATE ${snapshot.state} position=${snapshot.time.positionSeconds.toFixed(2)} duration=${snapshot.time.durationSeconds ?? 'null'}` +
          (error
            ? ` error=${error.code} firmware=${JSON.stringify(error.cause)}`
            : ''),
      );
    });
    // The ready handler is installed; open paused when asked so a frame can
    // be checked before any playback.
    show(
      `OPEN url=http:${/^https?:\/\//.test(url)} mode=${mode} start=${start}`,
    );
    void player
      .open({
        url,
        kind: 'vod',
        paused: mode === 'paused',
        startAtSeconds: start,
        deliveryFormat: 'mp4',
      })
      .then(() => show('OPENED'))
      .catch((error: { code?: string; message?: string }) =>
        show(`OPEN_FAILED ${error.code ?? 'unknown'} ${error.message ?? ''}`),
      );
  };

  const onKey = (input: Event) => {
    // The host raises keydown events only on the 'keydown' listener.
    const event = input as KeyboardEvent;
    if (event.key === 'Enter') {
      const next = !covered();
      setCovered(next);
      log('COVER ' + (next ? 'on' : 'off'));
    } else if (String(event.key).toLowerCase() === 'instantreplay') {
      player?.dispose();
      player = undefined;
      realSetTimeout(() => show('TEARDOWN pending=' + timers.size), 150);
    }
  };

  onMount(() => {
    const links = useService('links');
    const target = useService('keyEvents').target();
    target.addEventListener('keydown', onKey);
    log('READY');
    open(links.initial());
    links.subscribe((link) => open(link));
    onCleanup(() => {
      target.removeEventListener('keydown', onKey);
      player?.dispose();
    });
  });

  return (
    <view width={1920} height={1080}>
      <Show when={covered()}>
        {/* Opaque, above the player: the video must disappear under it. */}
        <view x={0} y={0} width={1920} height={1080} color="#ff0000ff" />
      </Show>
      <text x={40} y={980} width={1800} color="#ffffffff" fontSize={22}>
        {line()}
      </text>
    </view>
  );
}

startApp(rokuHost(), App);
