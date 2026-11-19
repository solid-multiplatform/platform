import * as v from 'vitest';
import { createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import { Select } from '@solid-multiplatform/platform/primitives';
import { renderer, waitForUpdate } from './setup.js';
import { capturePhoto, startRecording } from '../src/sdk/capture.js';
import { openMicrophoneStream } from '../src/hosts/web-services/index.js';
import { applySystemBarStyle, requestAppReview } from '../src/sdk/device.js';
import { bindMediaKeys } from '../src/sdk/media.js';
import { CapabilityError, serviceAvailable } from '../src/sdk/registry.js';
import {
  expectIdleWebProviders,
  expectSameTurn,
  forbid,
  provide,
  useWebServices,
  withoutServices,
} from './services-helpers.js';

const texts = (node: unknown): string[] => {
  const current = node as { text?: string; children?: readonly unknown[] };
  if (typeof current.text === 'string') return [current.text];
  return (current.children ?? []).flatMap((child) => texts(child));
};

const find = (
  node: unknown,
  predicate: (node: lng.ElementNode) => boolean,
): lng.ElementNode | undefined => {
  if (!lng.isINode(node)) return undefined;
  if (lng.isElementNode(node) && predicate(node)) return node;
  for (const child of node.children) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return undefined;
};

const findAll = (
  node: unknown,
  predicate: (node: lng.ElementNode) => boolean,
  found: lng.ElementNode[] = [],
): lng.ElementNode[] => {
  if (!lng.isINode(node)) return found;
  if (lng.isElementNode(node) && predicate(node)) found.push(node);
  for (const child of node.children) findAll(child, predicate, found);
  return found;
};

v.describe('Select', () => {
  v.it('opens the menu and reports the chosen value', async () => {
    const [value, setValue] = createSignal('a');
    const dispose = renderer.render(() => (
      <view width={500} height={400}>
        <Select
          x={20}
          y={20}
          value={value}
          label="Choice"
          options={[
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Beta' },
            { value: 'c', label: 'Gamma' },
          ]}
          onChange={(next) => setValue(() => next)}
        />
      </view>
    ));
    await waitForUpdate();
    const trigger = find(
      renderer.rootNode,
      (node) =>
        typeof node.onMouseClick === 'function' &&
        texts(node).includes('Alpha'),
    )!;
    trigger.onMouseClick?.(new MouseEvent('click'), trigger);
    await waitForUpdate();

    const gamma = findAll(
      renderer.rootNode,
      (node) =>
        typeof node.onMouseClick === 'function' &&
        texts(node).includes('Gamma'),
    ).at(-1)!;
    gamma.onMouseClick?.(new MouseEvent('click'), gamma);
    v.expect(value()).toBe('c');
    await waitForUpdate();
    v.expect(
      find(
        renderer.rootNode,
        (node) =>
          typeof node.onMouseClick === 'function' &&
          texts(node).includes('Gamma') &&
          !texts(node).includes('Alpha'),
      ),
    ).toBeDefined();
    dispose();
  });
});

v.describe('camera and microphone', () => {
  useWebServices();

  /** A `MediaRecorder` that records one chunk and stops when told to. */
  const fakeRecorder = () => {
    const made: FakeRecorder[] = [];
    class FakeRecorder {
      static isTypeSupported = (type: string) => type === 'audio/mp4';
      mimeType: string;
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
      onerror?: () => void;
      calls: string[] = [];
      constructor(
        public stream: unknown,
        options?: { mimeType?: string },
      ) {
        this.mimeType = options?.mimeType ?? 'audio/webm';
        made.push(this);
      }
      start() {
        this.calls.push('start');
      }
      stop() {
        this.calls.push('stop');
        this.ondataavailable?.({ data: new Blob(['abc']) });
        this.ondataavailable?.({ data: new Blob([]) });
        this.onstop?.();
      }
    }
    v.vi.stubGlobal('MediaRecorder', FakeRecorder);
    v.onTestFinished(() => {
      v.vi.unstubAllGlobals();
    });
    return made;
  };

  v.it('captures photos and recordings through host ports', async () => {
    const calls: string[] = [];
    provide({
      camera: {
        async capture(options) {
          calls.push(`capture:${options.facingMode}`);
          return {
            dataUrl: 'data:image/jpeg;base64,x',
            width: 640,
            height: 480,
          };
        },
      },
    });
    v.expect(await capturePhoto({ facingMode: 'environment' })).toEqual({
      dataUrl: 'data:image/jpeg;base64,x',
      width: 640,
      height: 480,
    });
    v.expect(calls).toEqual(['capture:environment']);

    // A native host records to a file: no browser type crosses the port.
    const recording = { mimeType: 'audio/mp4', path: '/cache/a.m4a' };
    provide({
      microphone: {
        start: async (options) => {
          calls.push(`start:${options.mimeType}`);
          return {
            stop: async () => {
              calls.push('stop');
              return recording;
            },
          };
        },
      },
    });
    const session = await startRecording({ mimeType: 'audio/mp4' });
    v.expect(await session.stop()).toBe(recording);
    v.expect(calls).toEqual(['capture:environment', 'start:audio/mp4', 'stop']);
  });

  v.it('the web provider records with MediaRecorder into a blob', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    const stopped: string[] = [];
    const stream = {
      getTracks: () => [{ stop: () => stopped.push('audio') }],
    } as unknown as MediaStream;
    const recorders = fakeRecorder();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => stream },
    });
    try {
      // A type the browser records is asked for; another is left to it.
      const session = await startRecording({ mimeType: 'audio/mp4' });
      v.expect(recorders[0]!.stream).toBe(stream);
      v.expect(recorders[0]!.calls).toEqual(['start']);
      const first = session.stop();
      // Stopping twice gives the one recording.
      v.expect(session.stop()).toBe(first);
      const recording = await first;
      v.expect(recorders[0]!.calls).toEqual(['start', 'stop']);
      v.expect(recording.mimeType).toBe('audio/mp4');
      v.expect(recording.blob!.size).toBe(3);
      v.expect(recording.blob!.type).toBe('audio/mp4');
      v.expect(recording.durationMs).toBeGreaterThanOrEqual(0);
      v.expect(recording.path).toBeUndefined();
      // The microphone is released with the recording.
      v.expect(stopped).toEqual(['audio']);

      const other = await startRecording({ mimeType: 'audio/flac' });
      v.expect((await other.stop()).mimeType).toBe('audio/webm');
    } finally {
      if (original) Object.defineProperty(navigator, 'mediaDevices', original);
      else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    }
  });

  v.it('the web providers need navigator.mediaDevices', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    const stopped: string[] = [];
    const stream = {
      getTracks: () => [{ stop: () => stopped.push('audio') }],
    } as unknown as MediaStream;
    try {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: undefined,
      });
      await v.expect(capturePhoto()).rejects.toThrowError(/camera/);
      // No MediaRecorder (jsdom), then no mediaDevices: neither can record.
      await v.expect(startRecording()).rejects.toThrowError(/microphone/);
      fakeRecorder();
      await v.expect(startRecording()).rejects.toThrowError(/microphone/);
      await v.expect(openMicrophoneStream()).rejects.toThrowError(/microphone/);

      const constraints: unknown[] = [];
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async (value: unknown) => {
            constraints.push(value);
            return stream;
          },
        },
      });
      // Web only: the live stream, which the app stops itself.
      v.expect(await openMicrophoneStream()).toBe(stream);
      v.expect(constraints).toEqual([{ audio: true }]);
      v.expect(stopped).toEqual([]);
    } finally {
      if (original) Object.defineProperty(navigator, 'mediaDevices', original);
      else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    }
  });

  v.it(
    'without camera and microphone services nothing asks the browser',
    async () => {
      const restore = forbid(navigator, 'mediaDevices');
      const create = v.vi.spyOn(document, 'createElement');
      try {
        await withoutServices(async () => {
          await v.expect(capturePhoto()).rejects.toMatchObject({
            name: 'CapabilityError',
            capability: 'camera',
          });
          await v.expect(startRecording()).rejects.toMatchObject({
            name: 'CapabilityError',
            capability: 'microphone',
          });
        });
        v.expect(create).not.toHaveBeenCalled();
      } finally {
        create.mockRestore();
        restore();
      }
    },
  );

  v.it(
    'the permission prompts are asked for in the same turn as the call',
    async () => {
      const original = Object.getOwnPropertyDescriptor(
        navigator,
        'mediaDevices',
      );
      const getUserMedia = v.vi.fn(async () => {
        throw new DOMException('denied', 'NotAllowedError');
      });
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia },
      });
      fakeRecorder();
      try {
        await expectSameTurn(getUserMedia, () => capturePhoto());
        await expectSameTurn(getUserMedia, () => startRecording());
        v.expect(getUserMedia.mock.calls).toEqual([
          [{ video: true }],
          [{ audio: true }],
        ]);
      } finally {
        if (original)
          Object.defineProperty(navigator, 'mediaDevices', original);
        else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
      }
    },
  );

  v.it('the web providers are installed without doing any work', () => {
    expectIdleWebProviders({ eager: ['camera', 'microphone'] });
  });
});

v.describe('system bars and app review', () => {
  useWebServices();

  v.it('applies a host system-bar style and restores it', () => {
    const calls: string[] = [];
    provide({
      systemBars: {
        apply(style) {
          calls.push(`${style.statusBarColor}:${style.lightStatusIcons}`);
          return () => calls.push('restored');
        },
      },
    });
    const restore = applySystemBarStyle({
      statusBarColor: 0x112233ff,
      lightStatusIcons: false,
    });
    v.expect(calls).toEqual(['287454207:false']);
    restore();
    v.expect(calls).toEqual(['287454207:false', 'restored']);
  });

  v.it('the web provider uses the theme-color meta tag', () => {
    const existing = document.querySelector('meta[name="theme-color"]');
    existing?.remove();
    const restore = applySystemBarStyle({ statusBarColor: 0x112233ff });
    const meta = document.querySelector('meta[name="theme-color"]')!;
    v.expect(meta.getAttribute('content')).toBe('#112233');
    restore();
    v.expect(document.querySelector('meta[name="theme-color"]')).toBeNull();
  });

  v.it('requests an app review when the host supports it', async () => {
    v.expect(await requestAppReview()).toBe(false);
    provide({ appReview: { request: async () => true } });
    v.expect(await requestAppReview()).toBe(true);
  });

  v.it(
    'without a system-bars service nothing is styled and the page is not touched',
    async () => {
      const query = v.vi.spyOn(document, 'querySelector');
      const create = v.vi.spyOn(document, 'createElement');
      try {
        await withoutServices(async () => {
          v.expect(() =>
            applySystemBarStyle({ statusBarColor: 0x112233ff }),
          ).toThrowError(CapabilityError);
          v.expect(await requestAppReview()).toBe(false);
        });
        v.expect(query).not.toHaveBeenCalled();
        v.expect(create).not.toHaveBeenCalled();
      } finally {
        query.mockRestore();
        create.mockRestore();
      }
    },
  );

  v.it(
    'the web system bars are a plain object; the browser has no app review',
    () => {
      expectIdleWebProviders({ eager: ['systemBars'] });
      v.expect(serviceAvailable('appReview')).toBe('unavailable');
    },
  );
});

v.describe('media keys', () => {
  useWebServices();

  v.it('maps hardware transport keys to actions', () => {
    const target = new EventTarget();
    const calls: string[] = [];
    const dispose = bindMediaKeys(
      {
        playpause: () => calls.push('playpause'),
        next: () => calls.push('next'),
        previous: () => calls.push('previous'),
      },
      target,
    );
    for (const key of [
      'MediaPlayPause',
      'MediaTrackNext',
      'MediaTrackPrevious',
      'MediaStop',
    ]) {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key, cancelable: true }),
      );
    }
    v.expect(calls).toEqual(['playpause', 'next', 'previous']);
    dispose();
  });

  const press = (target: EventTarget, key: string) =>
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, cancelable: true }),
    );

  v.it('listens where the host delivers keys: the window on the web', () => {
    const calls: string[] = [];
    const dispose = bindMediaKeys({ play: () => calls.push('play') });
    press(window, 'MediaPlay');
    v.expect(calls).toEqual(['play']);
    dispose();
    press(window, 'MediaPlay');
    v.expect(calls).toEqual(['play']);

    const keys = new EventTarget();
    provide({ keyEvents: { target: () => keys } });
    const disposeHost = bindMediaKeys({ stop: () => calls.push('stop') });
    press(window, 'MediaStop');
    press(keys, 'MediaStop');
    v.expect(calls).toEqual(['play', 'stop']);
    disposeHost();
  });

  v.it(
    'binds nothing, and adds no window listener, on a host without key events',
    async () => {
      const listen = v.vi.spyOn(window, 'addEventListener');
      const calls: string[] = [];
      try {
        await withoutServices(() => {
          const dispose = bindMediaKeys({ play: () => calls.push('play') });
          press(window, 'MediaPlay');
          dispose();
        });
        v.expect(calls).toEqual([]);
        v.expect(listen).not.toHaveBeenCalled();
      } finally {
        listen.mockRestore();
      }
    },
  );

  v.it('the web key target is not read until a helper asks for it', () => {
    expectIdleWebProviders({ eager: ['keyEvents'] });
  });
});
