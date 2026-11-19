// The device test of the Roku host, started the way an app is:
// startApp(rokuHost(), App). run-host.mjs installs it, presses keys, sends
// deep links and reads what this prints on the console:
//   - focus moves with the arrows and Select activates (a modal opens);
//   - Back inside the modal is handled, Back at the root is not (the host
//     then exits the channel);
//   - the links service has the launch deep link and hears input events;
//   - a setting written on one launch is read on the next;
//   - deviceInfo and locale answer from the device;
//   - nothing is scheduled once the scene has settled;
//   - launched with contentId=boot-error, the app throws while starting.
import { createSignal, onMount, Show, type JSXElement } from 'solid-js';
import { deviceInfo, type ElementNode } from '@solid-multiplatform/platform';
import {
  startApp,
  type HostContext,
} from '@solid-multiplatform/platform/host';
import { Row } from '@solid-multiplatform/platform/primitives';
import {
  rokuHost,
  rokuKeyMap,
  type RokuSurface,
} from '@solid-multiplatform/platform/roku';
import {
  installedServices,
  loadService,
  serviceAvailable,
  useService,
} from '@solid-multiplatform/platform/services';
import { getRegistry } from '@roku-sdk/rsg-ts/runtime';
import robotoRegular from './fonts/Roboto-Regular.ttf';
import { BG, BUTTONS, FOCUSED, IDLE, MODAL, SCREEN } from './host-cases.mjs';

// Every timer armed from here on, for the idle count. `timeout` is the
// test's own clock and is not counted.
let scheduled = 0;
const timeout = globalThis.setTimeout;
const interval = globalThis.setInterval;
globalThis.setTimeout = ((handler: () => void, ms?: number) => {
  scheduled++;
  return timeout(handler, ms);
}) as typeof globalThis.setTimeout;
globalThis.setInterval = ((handler: () => void, ms?: number) => {
  scheduled++;
  return interval(handler, ms);
}) as typeof globalThis.setInterval;
const sleep = (ms: number) => new Promise<void>((done) => timeout(done, ms));
const log = (line: string) => console.log('HOST ' + line);
/** The registry section the test's settings live in. */
const NAMESPACE = 'smp-host-test';

/** What the services answer, without printing anything that names the device. */
async function report(): Promise<void> {
  const scope = globalThis as Record<string, unknown>;
  log(
    'GLOBALS ' +
      ['document', 'window', 'navigator', 'localStorage', 'history', 'location']
        .map((name) => name + '=' + typeof scope[name])
        .join(' '),
  );
  log('SERVICES ' + installedServices().join(','));
  const info = (await deviceInfo()) as Awaited<ReturnType<typeof deviceInfo>> & {
    displayMode?: string;
  };
  log(
    `DEVICE platform=${info.platform} model=${typeof info.model === 'string' && info.model.length > 0} osVersion=${info.osVersion} appVersion=${info.appVersion} displayMode=${info.displayMode}`,
  );
  log('LOCALE ' + useService('locale').current());
  const settings = await loadService('settings');
  const before = await settings.get('launches');
  log('SETTINGS before=' + before);
  const next = String((Number(before) || 0) + 1);
  await settings.set('launches', next);
  log('SETTINGS wrote=' + (await settings.get('launches')));
  log('SETTINGS missing=' + (await settings.get('never-written')));

  // Encrypted storage: the value reads back, the registry holds something
  // else, and the last launch's value is still readable.
  const secure = await loadService('secureStorage');
  log('SECURE before=' + (await secure.get('token')));
  const secret = 'host-secret-' + next;
  await secure.set('token', secret);
  const stored =
    (await getRegistry()).create(NAMESPACE + '.secure').read('token') ?? '';
  let plain = '';
  for (let i = 0; i < 11; i++) plain += secret.charCodeAt(i).toString(16);
  log(
    `SECURE wrote=${await secure.get('token')} storedHex=${/^[0-9a-f]+$/.test(stored)} storedLength=${stored.length} holdsPlainText=${stored.includes(plain) || stored.includes(secret)}`,
  );

  log('MEMORY ' + JSON.stringify(useService('memory').get()));
  // The names the firmware gives its memory levels, which the provider reads.
  log(
    'MEMORY levels=' +
      Object.keys(
        (scope.roku as { MemoryLevel?: object } | undefined)?.MemoryLevel ?? {},
      ).join(','),
  );
  // Each key release, as the key events service raises it.
  useService('keyEvents')
    .target()
    .addEventListener('keyup', (event) =>
      log('KEYEVENTS keyup ' + (event as unknown as { key: string }).key),
    );
  const connectivity = useService('connectivity');
  connectivity.subscribe((online) => log('CONNECTIVITY event online=' + online));
  log('CONNECTIVITY online=' + connectivity.online());

  if (serviceAvailable('lifecycle') === 'available') {
    const lifecycle = await loadService('lifecycle');
    log('LIFECYCLE active=' + lifecycle.active());
    lifecycle.subscribe((active) => log('LIFECYCLE event active=' + active));
  }

  // The firmware's fetch: a public HTTPS page, with a header, and a host
  // that does not exist.
  const { fetch: request } = await loadService('request');
  try {
    const response = await request('https://example.com/', {
      headers: { accept: 'text/html' },
    });
    const body = await response.text();
    log(
      `FETCH page status=${response.status} ok=${response.ok} body=${body.includes('Example Domain')}`,
    );
  } catch (error) {
    log('FETCH page rejected ' + String(error).slice(0, 120));
  }
  try {
    const response = await request('https://no-such-host.invalid/');
    log(`FETCH missing status=${response.status} ok=${response.ok}`);
  } catch (error) {
    log('FETCH missing rejected ' + String(error).slice(0, 120));
  }
}

function Modal(props: { close: () => void }): JSXElement {
  let node!: ElementNode;
  onMount(() => node.setFocus());
  return (
    <view
      ref={node}
      x={MODAL.x}
      y={MODAL.y}
      width={MODAL.w}
      height={MODAL.h}
      color={MODAL.color}
      onBack={() => {
        log('BACK consumed');
        props.close();
        return true;
      }}
    />
  );
}

function App(context: HostContext<RokuSurface>): JSXElement {
  log('START');
  /** The device keyboard, for an e-mail address. */
  const edit = () => {
    const editor = context.text!.createEditor({
      label: 'Email',
      purpose: 'email',
      onChange: (value) => log('EDITOR change ' + value),
      onSubmit: (value) => log('EDITOR submit ' + value),
      onBlur: () => {
        log('EDITOR closed');
        editor.dispose();
      },
    });
    editor.focus();
    log('EDITOR open');
  };
  const links = useService('links');
  const initial = links.initial();
  log('LINK initial ' + initial);
  if (initial?.includes('contentId=boot-error'))
    throw new Error('HOST deliberate boot error');
  links.subscribe((link) => {
    log('LINK event ' + link);
    if (link.includes('contentId=idle-check')) {
      const before = scheduled;
      void sleep(2000).then(() => log('IDLE timers=' + (scheduled - before)));
    }
  });
  const [focused, setFocused] = createSignal(-1);
  const [modal, setModal] = createSignal(false);
  let row!: ElementNode;
  void report()
    .then(() => sleep(1000))
    .then(
      () => log('READY'),
      (error: unknown) =>
        log('ERROR ' + String((error as Error)?.stack ?? error)),
    );
  return (
    <view
      width={SCREEN.w}
      height={SCREEN.h}
      color={BG}
      onCaptureKey={(event: { key: string; repeat: boolean }) => {
        if (event.repeat) log('REPEAT ' + event.key);
        return false;
      }}
      onCaptureKeyRelease={(event: { key: string }) => {
        log('RELEASE ' + event.key);
        return false;
      }}
      onPlayPause={() => {
        log('KEY PlayPause');
        return true;
      }}
    >
      <text x={BUTTONS[0]!.x} y={120} fontFamily="Roboto" fontSize={48}>
        Roku host test
      </text>
      <Row
        ref={row}
        autofocus
        scroll="none"
        x={BUTTONS[0]!.x}
        y={BUTTONS[0]!.y}
        width={BUTTONS[2]!.x + BUTTONS[2]!.w - BUTTONS[0]!.x}
        height={BUTTONS[0]!.h}
        gap={BUTTONS[1]!.x - BUTTONS[0]!.x - BUTTONS[0]!.w}
      >
        {BUTTONS.map((button, index) => (
          <view
            width={button.w}
            height={button.h}
            color={focused() === index ? FOCUSED : IDLE}
            onFocusChanged={(has: boolean) => {
              if (!has) return;
              setFocused(index);
              log('FOCUS b' + index);
            }}
            onEnter={() => {
              log('SELECT b' + index);
              // The last button opens the keyboard, the others the modal.
              if (index === BUTTONS.length - 1) edit();
              else {
                setModal(true);
                log('MODAL open');
              }
              return true;
            }}
          />
        ))}
      </Row>
      <Show when={modal()}>
        <Modal
          close={() => {
            setModal(false);
            log('MODAL closed');
            row.setFocus();
          }}
        />
      </Show>
    </view>
  );
}

startApp(rokuHost({ namespace: NAMESPACE }), App, {
  fonts: [{ fontFamily: 'Roboto', fontUrl: robotoRegular }],
  keyMap: rokuKeyMap,
});
