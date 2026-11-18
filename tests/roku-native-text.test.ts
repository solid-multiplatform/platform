import * as v from 'vitest';
import { createNativeTextEntry } from '../hosts/roku/native-text-entry.js';

const setup = () => {
  const parent = { children: [] as Array<{ props: Record<string, unknown> }> };
  const entry = createNativeTextEntry(parent);
  const events: unknown[] = [];
  const request = {
    title: 'Sign in',
    initial: '',
    numeric: false,
    secret: false,
    maximumLength: 60,
    confirm: 'Done',
    change: (value: string) => events.push(['change', value]),
    done: (value: string) => events.push(['done', value]),
    cancel: () => events.push(['cancel']),
    failed: () => events.push(['failed']),
  };
  return { parent, entry, events, request };
};

v.describe('Roku native text entry', () => {
  v.it('passes voice/domain and returns the entered text', () => {
    const { parent, entry, events, request } = setup();
    const handle = entry.open({
      ...request,
      domain: 'email',
      voice: false,
    });
    const node = parent.children[0];
    v.expect(node.props.request).toMatchObject({
      domain: 'email',
      voice: false,
      numeric: false,
    });

    (node.props.onResult as (value: unknown) => void)({
      action: 'done',
      text: 'ada@example.test',
    });
    v.expect(events).toEqual([['done', 'ada@example.test']]);
    v.expect(entry.ownsInput()).toBe(false);
    handle.close();
    v.expect(parent.children).toHaveLength(0);
  });

  v.it('wires PIN requests and rejects non-numeric edits', () => {
    const { parent, entry, events, request } = setup();
    entry.open({ ...request, numeric: true, initial: '12' });
    const node = parent.children[0];
    v.expect(node.props.request).toMatchObject({
      numeric: true,
      initial: '12',
    });

    (node.props.onEdit as (value: unknown) => void)({ text: '123' });
    v.expect(events).toContainEqual(['change', '123']);
    (node.props.onEdit as (value: unknown) => void)({ text: '12a' });
    v.expect(events.at(-1)).toEqual(['failed']);
    v.expect(parent.children).toHaveLength(0);
  });

  it_cleanup();
});

function it_cleanup() {
  v.it('close is idempotent and removes the dialog node', () => {
    const { parent, entry, request } = setup();
    const handle = entry.open(request);
    handle.close();
    handle.close();
    v.expect(parent.children).toHaveLength(0);
    v.expect(entry.ownsInput()).toBe(false);
  });
}
