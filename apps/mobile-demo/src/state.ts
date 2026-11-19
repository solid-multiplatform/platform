/**
 * The Discover mode's long-lived state: four rail scrollers, the page
 * scroller, and the lazily loaded rails. It lives at the app root so
 * switching to Chat and back keeps every offset and every loaded poster.
 */
import { createSignal } from 'solid-js';
import {
  apiEnabled,
  apiRail,
  RAILS,
  SAMPLE,
  type RailKey,
  type Title,
} from './catalog';
import { createScroller, type Scroller } from './scroller';

export interface RailState {
  items: Title[];
  loading: boolean;
  /** True once the rail has held its loaded state long enough to fetch the next. */
  settled: boolean;
}

export type RailStates = Record<RailKey, RailState>;

const empty = (): RailStates =>
  RAILS.reduce((out, rail) => {
    out[rail.key] = { items: [], loading: true, settled: false };
    return out;
  }, {} as RailStates);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createDiscoverState(
  cardWidth: () => number,
  gap: () => number,
) {
  const page = createScroller({ axis: 'y' });
  const railScrollers = RAILS.reduce(
    (out, rail) => {
      out[rail.key] = createScroller({
        axis: 'x',
        snap: () => cardWidth() + gap(),
        onSettle: () => {
          const index = RAILS.findIndex((entry) => entry.key === rail.key);
          kick(index + 1);
        },
      });
      return out;
    },
    {} as Record<RailKey, Scroller>,
  );

  const [rails, setRails] = createSignal<RailStates>(empty());
  let generation = 0;
  let started = 0;
  let slowNext = false;
  let nextTimer: ReturnType<typeof setTimeout> | undefined;

  async function load(index: number) {
    const rail = RAILS[index];
    if (!rail) return;
    const current = generation;
    // A short beat on the bundled data makes the skeleton a real state, not
    // a flash: the placeholder is always shaped like the card that replaces it.
    // A manual refresh holds the first rail a little longer so the shimmer is
    // visible even on a fast local catalogue.
    const hold = index === 0 ? (slowNext ? 2200 : 760) : 420;
    if (index === 0) slowNext = false;
    await wait(hold);
    if (current !== generation) return;
    let items: Title[] = SAMPLE[rail.key] ?? [];
    if (apiEnabled()) {
      try {
        const remote = await apiRail(rail.key);
        if (remote.length > 0) items = remote;
      } catch {
        // The bundled rail keeps the page complete when TMDB is unreachable.
      }
    }
    if (current !== generation) return;
    setRails((previous) => ({
      ...previous,
      [rail.key]: { items, loading: false, settled: false },
    }));
    // The rail has settled at rest; the next fetch starts only now.
    nextTimer = setTimeout(() => {
      if (current !== generation) return;
      setRails((previous) => ({
        ...previous,
        [rail.key]: { ...previous[rail.key], settled: true },
      }));
      kick(index + 1);
    }, 280);
  }

  function kick(index: number) {
    if (index < 0 || index >= RAILS.length) return;
    if (index < started) return;
    if (index > started) return;
    started = index + 1;
    void load(index);
  }

  function reload() {
    slowNext = true;
    generation++;
    started = 0;
    if (nextTimer) clearTimeout(nextTimer);
    setRails(empty());
    for (const rail of RAILS) railScrollers[rail.key].to(0, 0);
    page.to(0, 0);
    kick(0);
  }

  kick(0);

  return { page, railScrollers, rails, reload };
}

export type DiscoverState = ReturnType<typeof createDiscoverState>;

// ---- Chat

import { dateLabel, generateChat, type ChatItem } from './chat';

const REPLIES = [
  'Looks good from here.',
  'I can take that one.',
  'Give me a minute and I will check.',
  'The rail snaps cleanly now.',
  'Agreed. Let us keep it simple.',
  'I pushed the change.',
];

export function createChatState() {
  const scroller = createScroller({ axis: 'y' });
  const [messages, setMessages] = createSignal<ChatItem[]>(generateChat(10000));
  const [typing, setTyping] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [jump, setJump] = createSignal(0);
  let nextId = 2_000_000;
  let replyIndex = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const append = (entry: ChatItem) =>
    setMessages((previous) => [...previous, entry]);

  function reply() {
    const at = Date.now();
    append({
      kind: 'message',
      id: nextId++,
      mine: false,
      author: 'Maya Chen',
      at,
      text: REPLIES[replyIndex++ % REPLIES.length]!,
      layout: 'text',
    });
    setTyping(false);
  }

  function send(value: string) {
    const text = value.trim();
    if (!text) return;
    const at = Date.now();
    const last = messages()[messages().length - 1];
    if (last && last.kind === 'message' && !sameDayAt(last, at)) {
      append({ kind: 'date', id: nextId++, label: dateLabelOf(at) });
    }
    append({
      kind: 'message',
      id: nextId++,
      mine: true,
      author: 'You',
      at,
      text,
      layout: 'text',
    });
    setDraft('');
    setTyping(true);
    setJump((value) => value + 1);
    if (timer) clearTimeout(timer);
    timer = setTimeout(reply, 1100);
  }

  return { scroller, messages, typing, draft, setDraft, send, jump };
}

function sameDayAt(entry: ChatItem, at: number) {
  if (entry.kind !== 'message') return true;
  const a = new Date(entry.at);
  const b = new Date(at);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dateLabelOf(at: number) {
  return dateLabel(at);
}
