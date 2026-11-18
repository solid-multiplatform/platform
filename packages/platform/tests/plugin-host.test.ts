import { expect, test } from 'vitest';
import { attachPlugins } from '../src/hosts/plugins.js';

test('native attachments share the host and clean up once in reverse order', () => {
  const host = { target: 'android-tv' as const, root: {}, canvas: {} };
  const calls: string[] = [];
  const dispose = attachPlugins(
    {
      first: {
        attach(value) {
          expect(value).toBe(host);
          return () => {
            calls.push('first');
          };
        },
      },
      second: {
        attach() {
          return () => {
            calls.push('second');
          };
        },
      },
    },
    host,
  );
  dispose();
  dispose();
  expect(calls).toEqual(['second', 'first']);
});

test('a failed attachment releases earlier native views', () => {
  const removed: string[] = [];
  expect(() =>
    attachPlugins(
      {
        attached: {
          attach: () => () => {
            removed.push('view');
          },
        },
        failure: {
          attach: () => {
            throw new Error('attach failed');
          },
        },
      },
      { target: 'web' },
    ),
  ).toThrow('attach failed');
  expect(removed).toEqual(['view']);
});
