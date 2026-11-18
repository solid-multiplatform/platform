import * as v from 'vitest';
import { createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import { Select } from '@solid-multiplatform/platform/primitives';
import { renderer, waitForUpdate } from './setup.js';
import {
  capturePhoto,
  openMicrophone,
  setCameraPort,
  setMicrophonePort,
  stopMicrophone,
} from '../src/sdk/capture.js';
import {
  applySystemBarStyle,
  requestAppReview,
  resetDevicePorts,
  setDevicePorts,
} from '../src/sdk/device.js';
import { bindMediaKeys } from '../src/sdk/media.js';

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
  v.afterEach(() => {
    setCameraPort(undefined);
    setMicrophonePort(undefined);
  });

  v.it('captures photos and streams through host ports', async () => {
    const calls: string[] = [];
    setCameraPort({
      async capture(options) {
        calls.push(`capture:${options.facingMode}`);
        return { dataUrl: 'data:image/jpeg;base64,x', width: 640, height: 480 };
      },
    });
    v.expect(await capturePhoto({ facingMode: 'environment' })).toEqual({
      dataUrl: 'data:image/jpeg;base64,x',
      width: 640,
      height: 480,
    });
    v.expect(calls).toEqual(['capture:environment']);

    const stream = { getTracks: () => [] } as unknown as MediaStream;
    setMicrophonePort({
      start: async () => {
        calls.push('start');
        return stream;
      },
      stop: () => calls.push('stop'),
    });
    v.expect(await openMicrophone()).toBe(stream);
    stopMicrophone(stream);
    v.expect(calls).toEqual(['capture:environment', 'start', 'stop']);
  });

  v.it('throws a capability error without a camera port', async () => {
    await v.expect(capturePhoto()).rejects.toThrowError(/camera/);
  });
});

v.describe('system bars and app review', () => {
  v.afterEach(() => resetDevicePorts());

  v.it('applies a host system-bar style and restores it', () => {
    const calls: string[] = [];
    setDevicePorts({
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

  v.it('uses the theme-color meta tag on the web', () => {
    resetDevicePorts();
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
    setDevicePorts({ appReview: { request: async () => true } });
    v.expect(await requestAppReview()).toBe(true);
  });
});

v.describe('media keys', () => {
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
});
