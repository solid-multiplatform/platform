import * as v from 'vitest';
import { createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import { Select } from '@solid-multiplatform/platform/primitives';
import { renderer, waitForUpdate } from './setup.js';
import {
  capturePhoto,
  openMicrophone,
  stopMicrophone,
} from '../src/sdk/capture.js';
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

  v.it('captures photos and streams through host ports', async () => {
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

    const stream = { getTracks: () => [] } as unknown as MediaStream;
    provide({
      microphone: {
        start: async () => {
          calls.push('start');
          return stream;
        },
        stop: () => calls.push('stop'),
      },
    });
    v.expect(await openMicrophone()).toBe(stream);
    stopMicrophone(stream);
    v.expect(calls).toEqual(['capture:environment', 'start', 'stop']);
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
      await v.expect(openMicrophone()).rejects.toThrowError(/microphone/);

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
      v.expect(await openMicrophone()).toBe(stream);
      v.expect(constraints).toEqual([{ audio: true }]);
      stopMicrophone(stream);
      v.expect(stopped).toEqual(['audio']);
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
      const stopped: string[] = [];
      try {
        await withoutServices(async () => {
          await v.expect(capturePhoto()).rejects.toMatchObject({
            name: 'CapabilityError',
            capability: 'camera',
          });
          await v.expect(openMicrophone()).rejects.toMatchObject({
            name: 'CapabilityError',
            capability: 'microphone',
          });
          // A stream the app got elsewhere is still stopped.
          stopMicrophone({
            getTracks: () => [{ stop: () => stopped.push('track') }],
          } as unknown as MediaStream);
        });
        v.expect(stopped).toEqual(['track']);
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
      try {
        await expectSameTurn(getUserMedia, () => capturePhoto());
        await expectSameTurn(getUserMedia, () => openMicrophone());
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
