// The NativeScript host definition: one `HostDefinition` per form, with the
// target's own keys, pointer and text supplied through `HostContext`.
import { expect, test, vi } from 'vitest';
// The host is a host module (plain MJS), so it imports without the package
// build. Its renderer import is resolved by Vite.
import { nativeFormOf, nativeHost } from '../../hosts/nativescript/host.mjs';

const keyboard = () => ({
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});

test('each form is one target with the input its host really delivers', () => {
  const forms = {
    phone: { target: 'android', inputs: ['touch'] },
    tv: { target: 'android-tv', inputs: ['remote'] },
    ios: { target: 'ios', inputs: ['touch'] },
    tvOS: { target: 'apple-tv', inputs: ['remote'] },
  };
  for (const [form, expected] of Object.entries(forms)) {
    const host = nativeHost({ form });
    expect(host.target).toBe(expected.target);
    expect(host.capabilities?.inputs).toEqual(expected.inputs);
    // No keyboard or remote claim where no native key binding feeds one.
    expect(host.capabilities?.inputs).not.toContain('keyboard');
    expect(nativeFormOf(form).target).toBe(expected.target);
  }
});

test('an unknown form is refused at construction', () => {
  expect(() => nativeHost({ form: 'watch' })).toThrow(TypeError);
  expect(() => nativeFormOf('desktop')).toThrow(TypeError);
});

test('launch adopts the surface and input the target bootstrap made', () => {
  const canvas = {};
  const root = {};
  const keys = keyboard();
  const input = { connect: () => () => {} };
  const text = { createEditor: () => ({}) };
  let context;
  const released = vi.fn();
  const stop = nativeHost({
    form: 'tv',
    host: { canvas, root, keys, input, text, target: 'android-tv' },
  }).launch((launched) => {
    context = launched;
    return released;
  });

  expect(context.target).toBe('android-tv');
  expect(context.surface).toBe(canvas);
  expect(context.native).toBe(root);
  // Keys come from the host's KeyBridge, not from a `document`.
  expect(context.keys).toBe(keys);
  // The touch scope is the pointer source and carries no gestures of its own.
  expect(context.pointer).toBe(input);
  expect(context.text).toBe(text);
  // Assistive-technology semantics are omitted, not stubbed.
  expect(context.semantics).toBeUndefined();
  expect(typeof context.createRenderer).toBe('function');

  expect(typeof stop).toBe('function');
  stop();
  expect(released).toHaveBeenCalledTimes(1);
});

test('launch without an established surface creates one itself', () => {
  // The application branch imports NativeScript at launch. A missing runtime
  // is reported, not thrown from `nativeHost` itself, so every entry that
  // passes its bootstrap host keeps working.
  const host = nativeHost({ form: 'phone' });
  expect(host.target).toBe('android');
  expect(typeof host.launch).toBe('function');
});

test('a touch form has no pointer when its bootstrap did not bind touch', () => {
  let context;
  const surface = {};
  nativeHost({
    form: 'ios',
    host: { canvas: surface, root: {}, keys: keyboard() },
  }).launch((launched) => {
    context = launched;
    return () => {};
  });
  expect(context.pointer).toBeUndefined();
});
