/**
 * The chat's deterministic mock data: 10,000 messages, mixed senders and
 * lengths, occasional lists and code-ish lines, a timestamp each, and a date
 * separator whenever the day changes. No randomness at runtime: the same
 * scene on every launch, and layout can be computed before anything mounts.
 */
export interface Message {
  kind: 'message';
  id: number;
  mine: boolean;
  author: string;
  at: number;
  text: string;
  layout: 'text' | 'code' | 'list';
}

export interface DateRow {
  kind: 'date';
  id: number;
  label: string;
}

export type ChatItem = Message | DateRow;

export interface ChatLayoutItem {
  item: ChatItem;
  y: number;
  h: number;
  /** Bubble width for a message; the full width for a date row. */
  w: number;
  /** True when the previous row is a date or a different sender. */
  group: boolean;
}

const NAMES = [
  'Maya Chen',
  'Jonah Reed',
  'Priya Shah',
  'Theo Martins',
  'Ana Silva',
];
const SHORT = [
  'Sounds good.',
  'On it.',
  'That works for me.',
  "Let's ship it.",
  'Can you send the link?',
  'Nice.',
  'Agreed.',
  'Give me ten minutes.',
  'I like that.',
  'Perfect.',
  'Done.',
  'Where are we on this?',
];
const MEDIUM = [
  'The new build is up and the frame times look steady on the phone.',
  'I moved the hero copy down a little so it clears the status bar.',
  'Can we keep the cards at twelve-pixel corners? It reads calmer.',
  'The rail snaps nicely now. Next step is the skeleton sweep.',
  'I checked the details screen on the small device and the overview wraps cleanly.',
  'Let us keep one accent colour and let the typography do the rest.',
  'The list is virtualised: only the visible window is mounted.',
  'I replaced the placeholder posters with the real ones.',
  'Scrolling is smooth, but the momentum curve could settle a touch sooner.',
  'The empty state needs one line of copy, nothing more.',
  'I will take the chat screen and you take the discover page.',
  'That border is too bright against the background. Try the soft line colour.',
  'The timestamp belongs at the bottom of the bubble, not beside the name.',
  'We should show the typing indicator only after a send, never while idle.',
];
const LONG = [
  'I pulled the whole flow apart this morning and the thing that makes it feel good is restraint: one accent, generous spacing, and a type scale with real jumps. Everything else is noise.',
  'When the rail settles we can start the next fetch. That keeps the first paint cheap and means the skeleton is always shaped like the thing that replaces it, so nothing jumps.',
  'The virtual column only mounts the visible window plus a small buffer, so ten thousand messages cost the same as ten. The scrollbar is drawn from the offset and the content height.',
  'Two details matter on a phone: the drag has to follow the finger exactly, and the release has to carry momentum. Snapping is only for the poster rails, never for the conversation.',
  'I tried a heavier weight for the hero and it looked like a different app. Large size and tight leading do the work; the regular weight keeps it editorial.',
];
const LISTS = [
  'Three things before we ship:\n- skeletons match the card size\n- the rail snaps on release\n- the frame meter is off by default',
  'Todo for today:\n- finish the details screen\n- wire the lazy fetch\n- capture the six screenshots',
  'What I checked:\n- 1080 by 2400 phone\n- 1440 by 3120 phone\n- both modes without losing state',
  'Notes:\n- one accent only\n- twelve to sixteen pixel corners\n- a one pixel border where a surface needs an edge',
];
const CODE = [
  'const slot = cardWidth + gap;\nconst target = Math.round(offset / slot) * slot;',
  'createEffect(() => {\n  scroller.layout(totalHeight, viewport().height);\n});',
  'setTyping(true);\nsetTimeout(() => {\n  append(reply());\n  setTyping(false);\n}, 900);',
  'const visible = items.filter(\n  (item) => item.y + item.h > offset && item.y < offset + height,\n);',
  'if (wasAtBottom) scroller.to(scroller.max());',
];

function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const pad = (value: number) => String(value).padStart(2, '0');
const two = (value: number) => (value < 10 ? '0' + value : String(value));

export function formatTime(at: number) {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Hermes ignores toLocaleString options; format the parts directly. */
export function dateLabel(at: number) {
  const date = new Date(at);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

const sameDay = (a: number, b: number) => {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
};

/** 10,000 messages and their date rows, in time order. */
export function generateChat(count = 10000): ChatItem[] {
  const random = lcg(0x5eed1e);
  const out: ChatItem[] = [];
  // 20 October 2026, 08:12 local time.
  let at = new Date(2026, 9, 20, 8, 12, 0).getTime();
  let id = 0;
  for (let i = 0; i < count; i++) {
    at += Math.floor(35_000 + random() * 260_000);
    if (
      i === 0 ||
      !sameDay(
        out[out.length - 1]!.kind === 'date'
          ? at
          : (out[out.length - 1] as Message).at,
        at,
      )
    ) {
      out.push({ kind: 'date', id: id++, label: dateLabel(at) });
    }
    const mine = random() < 0.36;
    const roll = random();
    let text: string;
    let layout: Message['layout'] = 'text';
    if (roll < 0.36) text = SHORT[Math.floor(random() * SHORT.length)]!;
    else if (roll < 0.72) text = MEDIUM[Math.floor(random() * MEDIUM.length)]!;
    else if (roll < 0.88) text = LONG[Math.floor(random() * LONG.length)]!;
    else if (roll < 0.95) {
      text = LISTS[Math.floor(random() * LISTS.length)]!;
      layout = 'list';
    } else {
      text = CODE[Math.floor(random() * CODE.length)]!;
      layout = 'code';
    }
    out.push({
      kind: 'message',
      id: id++,
      mine,
      author: mine ? 'You' : NAMES[Math.floor(random() * NAMES.length)]!,
      at,
      text,
      layout,
    });
  }
  return out;
}

const CHAR_WIDTH = 8.15;
const CODE_CHAR = 7.3;

function lineCount(text: string, width: number, charWidth: number) {
  let lines = 0;
  for (const line of text.split('\n')) {
    lines += Math.max(
      1,
      Math.ceil(
        (line.length || 1) / Math.max(8, Math.floor(width / charWidth)),
      ),
    );
  }
  return lines;
}

export interface ChatMetrics {
  width: number;
  total: number;
  items: ChatLayoutItem[];
  /** The date row label visible at a y offset, for a sticky date chip. */
  dateAt(offset: number): string | undefined;
}

/**
 * Lay the chat out for a width. Heights are estimated conservatively (the
 * character width is wider than Lato's average), so a bubble's text never
 * overflows its slot and the scrollbar matches the content.
 */
export function layoutChat(items: ChatItem[], width: number): ChatMetrics {
  const bubbleMax = Math.min((width - 96) * 0.82, 430);
  const laid: ChatLayoutItem[] = [];
  let y = 0;
  let currentDate = '';
  let previousAuthor: string | undefined;
  for (const item of items) {
    if (item.kind === 'date') {
      laid.push({ item, y, h: 44, w: width, group: true });
      y += 44;
      currentDate = item.label;
      previousAuthor = undefined;
      continue;
    }
    const group =
      previousAuthor === undefined || previousAuthor !== item.author;
    const longest = item.text
      .split('\n')
      .reduce((max, line) => Math.max(max, line.length), 0);
    const rough = longest * (item.layout === 'code' ? 7.5 : 8.1) + 30;
    const bubbleW =
      longest <= 46 ? Math.max(76, Math.min(bubbleMax, rough)) : bubbleMax;
    const textWidth = bubbleW - 26;
    const lineHeight = item.layout === 'code' ? 19 : 21;
    const lines = lineCount(
      item.text,
      textWidth,
      item.layout === 'code' ? CODE_CHAR : CHAR_WIDTH,
    );
    const h = 30 + lines * lineHeight + (item.layout === 'code' ? 6 : 0);
    laid.push({ item, y, h, w: bubbleW, group });
    // 8 units inside a sender group, 20 between groups (iMessage-like).
    const gap = group ? 20 : 8;
    y += h + gap;
    previousAuthor = item.author;
  }
  const total = y + 8;
  return {
    width,
    total,
    items: laid,
    dateAt(offset: number) {
      let label = currentDate;
      for (const entry of laid) {
        if (entry.y > offset) break;
        if (entry.item.kind === 'date') label = entry.item.label;
      }
      return label || undefined;
    },
  };
}

/** The first item index whose bottom is below `offset`. */
export function firstVisible(items: ChatLayoutItem[], offset: number): number {
  let low = 0;
  let high = items.length - 1;
  let found = items.length;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const entry = items[mid]!;
    if (entry.y + entry.h < offset) low = mid + 1;
    else {
      found = mid;
      high = mid - 1;
    }
  }
  return Math.max(0, found - 1);
}

export { two };
