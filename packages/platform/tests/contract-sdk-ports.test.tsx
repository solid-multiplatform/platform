// Port shapes a native host can implement: no browser type is required to
// cross a port, and what a host learns on its own (a seek position, a locale
// change, the next page of a listing) has a way to reach the app.
import * as v from 'vitest';
import { renderer } from './setup.js';
import { getContacts, getContactsPage } from '../src/sdk/contacts.js';
import {
  Button,
  Controls,
  SearchField,
  TextField,
} from '../src/sdk/controls.jsx';
import { deviceInfo, share } from '../src/sdk/device.js';
import type { Editor, EditorHost, EditorOptions } from '../src/sdk/editor.js';
import { configureMediaSession } from '../src/sdk/media.js';
import { provide, useWebServices } from './services-helpers.js';

const defineOn = (target: object, name: string, value: unknown) => {
  const own = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, {
    value,
    configurable: true,
    writable: true,
  });
  v.onTestFinished(() => {
    if (own) Object.defineProperty(target, name, own);
    else delete (target as Record<string, unknown>)[name];
  });
};

v.describe('device info', () => {
  useWebServices();

  v.it('a host can name its operating system and architecture', async () => {
    provide({
      deviceInfo: {
        get: async () => ({ platform: 'desktop', os: 'linux', arch: 'x64' }),
      },
    });
    v.expect(await deviceInfo()).toMatchObject({
      platform: 'desktop',
      os: 'linux',
      arch: 'x64',
    });
  });
});

v.describe('share with files', () => {
  useWebServices();

  v.it('files reach the host port as given', async () => {
    const seen: unknown[] = [];
    provide({
      share: {
        share: async (options) => {
          seen.push(options);
          return 'shared';
        },
      },
    });
    const files = [{ path: '/cache/report.pdf', mimeType: 'application/pdf' }];
    v.expect(await share({ title: 'Report', files })).toBe('shared');
    v.expect(seen).toEqual([{ title: 'Report', files }]);
  });

  v.it(
    'the web provider shares blobs as Files where canShare allows it',
    async () => {
      const shared: ShareData[] = [];
      const asked: ShareData[] = [];
      let allow = true;
      defineOn(navigator, 'share', async (data: ShareData) => {
        shared.push(data);
      });
      defineOn(navigator, 'canShare', (data: ShareData) => {
        asked.push(data);
        return allow;
      });
      const blob = new Blob(['hello'], { type: 'text/plain' });
      const files = [
        { blob, name: 'hello.txt' },
        // A path means nothing to a browser: left out.
        { path: '/cache/other.txt' },
      ];
      v.expect(await share({ text: 'Look', files })).toBe('shared');
      v.expect(asked).toHaveLength(1);
      const sent = shared[0]!.files!;
      v.expect(sent).toHaveLength(1);
      v.expect(sent[0]).toBeInstanceOf(File);
      v.expect([sent[0]!.name, sent[0]!.type, sent[0]!.size]).toEqual([
        'hello.txt',
        'text/plain',
        5,
      ]);
      v.expect(shared[0]!.text).toBe('Look');

      // The browser cannot share these files: the text still goes.
      allow = false;
      v.expect(await share({ text: 'Look', files })).toBe('shared');
      v.expect(shared[1]!.files).toBeUndefined();
      v.expect(shared[1]!.text).toBe('Look');
    },
  );
});

v.describe('media session seekto', () => {
  useWebServices();

  v.it('the seekto handler is given the position in seconds', () => {
    const handlers = new Map<string, (details: { seekTime: number }) => void>();
    provide({
      mediaSession: {
        setMetadata() {},
        setPlaybackState() {},
        setActionHandler(action, handler) {
          if (handler) handlers.set(action, handler);
          else handlers.delete(action);
        },
      },
    });
    const seeks: number[] = [];
    let paused = 0;
    const dispose = configureMediaSession({
      actions: {
        seekto: (details) => seeks.push(details.seekTime),
        pause: () => paused++,
      },
    });
    handlers.get('seekto')!({ seekTime: 42.5 });
    (handlers.get('pause') as () => void)();
    v.expect(seeks).toEqual([42.5]);
    v.expect(paused).toBe(1);
    dispose();
    v.expect(handlers.size).toBe(0);
  });

  v.it("the web provider hands the browser's details to the handler", () => {
    const set = new Map<string, (details: object) => void>();
    defineOn(navigator, 'mediaSession', {
      playbackState: 'none',
      setActionHandler(action: string, handler: (details: object) => void) {
        if (handler) set.set(action, handler);
        else set.delete(action);
      },
    });
    const seeks: number[] = [];
    const dispose = configureMediaSession({
      actions: { seekto: (details) => seeks.push(details.seekTime) },
    });
    set.get('seekto')!({ action: 'seekto', seekTime: 12 });
    v.expect(seeks).toEqual([12]);
    dispose();
  });
});

v.describe('contacts pages', () => {
  useWebServices();
  const contact = (id: string) => ({ id, displayName: 'Contact ' + id });

  v.it('pages through a host that can, with its opaque cursor', async () => {
    const queries: unknown[] = [];
    provide({
      contacts: {
        list: async () => [contact('1'), contact('2'), contact('3')],
        async page(query = {}) {
          queries.push(query);
          return query.after === 'cursor-2'
            ? { contacts: [contact('3')] }
            : { contacts: [contact('1'), contact('2')], next: 'cursor-2' };
        },
      },
    });
    const first = await getContactsPage({ limit: 2 });
    v.expect(first).toEqual({
      contacts: [contact('1'), contact('2')],
      next: 'cursor-2',
    });
    const second = await getContactsPage({ limit: 2, after: first.next });
    v.expect(second).toEqual({ contacts: [contact('3')] });
    v.expect(queries).toEqual([{ limit: 2 }, { limit: 2, after: 'cursor-2' }]);
    // The array form is unchanged.
    v.expect(await getContacts()).toHaveLength(3);
  });

  v.it('a host that cannot page gives one last page', async () => {
    provide({ contacts: { list: async () => [contact('1')] } });
    v.expect(await getContactsPage({ search: 'c' })).toEqual({
      contacts: [contact('1')],
    });
  });
});

v.describe('the default i18n instance follows the host locale', () => {
  useWebServices();

  v.it(
    'subscribes on first use, refreshes, and stops when setupI18n replaces it',
    async () => {
      const listeners = new Set<() => void>();
      let tag = 'fr-FR';
      provide({
        locale: {
          current: () => tag,
          subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
      });
      // A copy of the module of its own: the default instance is module
      // state, and other files of this worker have used theirs already.
      const i18n = (await import(
        // @ts-expect-error -- the query makes Vite load a second copy
        '../src/sdk/i18n.js?default-instance'
      )) as typeof import('../src/sdk/i18n.js');
      // Importing listens to nothing.
      v.expect(listeners.size).toBe(0);
      v.expect(i18n.locale()).toBe('fr-FR');
      v.expect(listeners.size).toBe(1);

      tag = 'ar-EG';
      for (const listener of listeners) listener();
      v.expect(i18n.locale()).toBe('ar-EG');
      v.expect(i18n.dir()).toBe('rtl');

      // The app's own instance has the locale the app chose.
      i18n.setupI18n({ locale: 'en' });
      v.expect(listeners.size).toBe(0);
      v.expect(i18n.locale()).toBe('en');
    },
  );

  v.it('the web provider listens for languagechange only while asked', () => {
    const add = v.vi.spyOn(window, 'addEventListener');
    const remove = v.vi.spyOn(window, 'removeEventListener');
    v.onTestFinished(() => {
      add.mockRestore();
      remove.mockRestore();
    });
    return import('../src/hosts/web-services/device.sync.js').then((web) => {
      const listener = () => {};
      const stop = web.locale.subscribe!(listener);
      v.expect(add).toHaveBeenCalledWith('languagechange', listener);
      stop();
      v.expect(remove).toHaveBeenCalledWith('languagechange', listener);
    });
  });
});

v.describe('TextField with only a host editor', () => {
  const editorHost = () => {
    const created: EditorOptions[] = [];
    const calls: string[] = [];
    const host: EditorHost = {
      createEditor(options) {
        created.push(options);
        const editor: Editor = {
          focus: () => calls.push('focus'),
          blur: () => calls.push('blur'),
          value: () => '',
          setValue: (text) => calls.push('value:' + text),
          setBounds: (rect) => calls.push(`bounds:${rect.x},${rect.y}`),
          dispose: () => calls.push('dispose'),
        };
        return editor;
      },
    };
    return { host, created, calls };
  };
  const bounds = { x: 10, y: 20, width: 300, height: 60 };

  v.it("a host context's `text` is enough for text fields", () => {
    const { host, created, calls } = editorHost();
    const dispose = renderer.render(() => (
      <Controls text={host}>
        <TextField
          label="Name"
          value="Ada"
          bounds={bounds}
          autofocus
          onChange={() => {}}
        />
        <SearchField label="Find" bounds={bounds} onChange={() => {}} />
      </Controls>
    ));
    v.expect(created.map((options) => options.label)).toEqual(['Name', 'Find']);
    v.expect(created[1]!.purpose).toBe('search');
    v.expect(calls).toContain('focus');
    v.expect(calls).toContain('bounds:10,20');
    v.expect(calls).toContain('value:Ada');
    dispose();
    v.expect(calls.filter((call) => call === 'dispose')).toHaveLength(2);
  });

  v.it('other controls still need a control surface', () => {
    const { host } = editorHost();
    v.expect(() => {
      const dispose = renderer.render(() => (
        <Controls text={host}>
          <Button label="Go" bounds={bounds} />
        </Controls>
      ));
      dispose();
    }).toThrowError(/control surface/);
  });

  v.it('a control surface still serves text fields', () => {
    const { host, created } = editorHost();
    const surface = {
      ...host,
      create: () => ({ update() {}, focus() {}, dispose() {} }),
    };
    const dispose = renderer.render(() => (
      <Controls surface={surface}>
        <TextField label="Name" bounds={bounds} onChange={() => {}} />
        <Button label="Go" bounds={bounds} />
      </Controls>
    ));
    v.expect(created).toHaveLength(1);
    dispose();
  });

  v.it('a text field outside Controls says what is missing', () => {
    v.expect(() =>
      renderer.render(() => (
        <TextField label="Name" bounds={bounds} onChange={() => {}} />
      )),
    ).toThrowError(/host editor/);
  });
});
