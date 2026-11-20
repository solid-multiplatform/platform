/**
 * The chat's deterministic mock data and its height model.
 *
 * The transcript reads like a coding-agent session: user prompts, assistant
 * Markdown with headings, lists, inline code and links, tool calls (Read,
 * Edit, Bash, Search) with short outputs, file references with a line, and
 * the occasional fenced snippet. Ten thousand messages plus a date separator
 * whenever the day changes, all from one seeded sequence — the same scene on
 * every launch.
 *
 * Heights start as a conservative estimate per item. `ChatHeights` keeps a
 * Fenwick index of slot heights (content plus the gap after it), so the list
 * can ask for the total, an item's offset, or the item at an offset in
 * O(log n) without touching the transcript. A mounted message reports its
 * real height once; the index is corrected and the list anchors the first
 * visible item so the viewport does not jump.
 */
import { HeightIndex } from './heightIndex';

export type ToolStatus = 'running' | 'done' | 'error';

export type ChatPart =
  | { type: 'markdown'; text: string }
  | { type: 'code'; text: string; language?: string }
  | { type: 'file'; path: string; line?: number }
  | {
      type: 'tool';
      name: string;
      status?: ToolStatus;
      title?: string;
      input?: string;
      output?: string;
      durationMs?: number;
      expanded?: boolean;
    };

export interface Message {
  kind: 'message';
  id: number;
  role: 'user' | 'assistant';
  author: string;
  at: number;
  parts: ChatPart[];
}

export interface DateRow {
  kind: 'date';
  id: number;
  label: string;
}

export type ChatItem = Message | DateRow;

const AGENT = 'Claude';

const PROMPTS = [
  'The chat jumps when a message measures shorter than its estimate. Can you fix the anchor?',
  'Add a measured height index and keep the scroll position while cards expand.',
  'Read src/screens/Chat.tsx and tell me where the list computes its offsets.',
  'Run the scroller tests and tell me what fails.',
  'Make the assistant messages full width, with the author and time above the body.',
  'The tool cards should expand when I tap them and collapse when I tap again.',
  'Keep the composer above the keyboard inset on the small phone.',
  'The date separators should use small caps, like the rest of the app.',
  'Why does the frame meter drop when I fling the list?',
  'Move the height index to O(log n) and keep scrolling off the prefix scan.',
  'When you cite a line, add a file reference like src/screens/Chat.tsx:120.',
  'The mock transcript should be deterministic: the same scene on every launch.',
  'Tool output should be short. Two or three lines is enough.',
  'User bubbles go on the right; the assistant text spans the column.',
  'Check that nothing parses the whole transcript while I scroll.',
  'Keep one accent colour. The send button and the links, nothing else.',
  'Use a heading and a short list when you summarise what changed.',
  'Add fenced code when you show the anchor calculation.',
  'The typing indicator should appear only after I send, never while idle.',
  'What is the smallest change that keeps 10,000 messages smooth?',
  'Please keep the iOS scroll model exactly as it is.',
  'Can you make the tool card show the duration in milliseconds?',
];

const WORKING = [
  'Let me read the list first.',
  'I will check the geometry before changing anything.',
  'Running the suite.',
  'I found the prefix scan; replacing it now.',
  'Measuring the mounted message before touching the offset.',
  'Checking the cache path on a re-mount.',
  'Looking at where the composer height enters the viewport.',
  'The anchor is the first visible row; I will correct only the delta.',
];

const FINALS = [
  '## What changed\n\nThe list keeps a **measured height index**. An offscreen message costs a conservative estimate; a mounted one reports its real height once, and a correction above the viewport moves the offset by exactly its delta.\n\n- Offscreen messages are never measured.\n- The anchor is the first visible message.\n- Binary search stays O(log n).',
  'Fixed. The first visible message is the anchor now, so a measurement below the viewport does not move anything. I left the physics untouched.',
  '### Result\n\n- 10,000 messages, about twenty mounted at a time.\n- Tool cards toggle per message and start collapsed.\n- The typing indicator and composer are unchanged.\n\nSee [the design note](handoff/chat-design.md) for the anchoring rule.',
  '**Done.** The height index is a Fenwick tree: append, update and offset lookup are all O(log n). No transcript scan sits on the scroll path.',
  'The tests pass. I did not touch the iOS physics, and no timer runs while the scene is idle.',
  '## Anchor\n\nBefore a correction, capture the first visible key and its screen position; after the update, solve for the offset that gives it the same position.\n\nCorrections below the anchor apply nothing.',
  'The parse cache means a re-mounted message parses nothing. Only a message that has never been shown pays the parse.',
  'I kept the editorial look: one accent, no second hue. Tool cards are surface grey with a one-pixel line.',
  'Short version: the list no longer rebuilds heights on every message change. It appends an estimate and corrects the one entry that measured.',
  '### Checks\n\n- `npx tsc --noEmit` is clean.\n- `node --test src/scroller.test.ts` passes.\n- The height index has its own unit test.',
  'I moved the composer above `keyboardInset` and left the send target at 48 units.',
  'A correction above the viewport shifts the offset by the delta; one below it does nothing. That is the whole anchoring rule.',
  '## Summary\n\nThe window is computed from the index, not from a prefix array:\n\n- `indexAt(offset)` is the first row.\n- `offsetOf(index)` gives its top.\n- Only changed heights are written.\n\nThe [implementation](packages/platform/src/markdown/index.ts) is small on purpose.',
  "The measurement arrives on the wrapper's `onLayout`, after flex has placed the message. A re-mount measures again but still parses from the cache.",
  'I left bold for headings and lists; the size jump carries the hierarchy even if the Android face has no weight axis.',
];

const SNIPPETS = [
  'const anchor = index.indexAt(scroller.offset());\nconst screenY = index.offsetOf(anchor) - scroller.offset();\n// after the height update:\nconst next = index.offsetOf(anchor) - screenY;',
  'scroller.layout(total(), viewH(), atBottom ? "bottom" : undefined);',
  'const start = index.indexAt(offset - overscan);\nconst end = index.indexAt(offset + viewH() + overscan);',
  'if (index.set(i, measured + gap)) scroller.shift(delta);',
  '<ChatMessage\n  role={message.role}\n  author={message.author}\n  time={formatTime(message.at)}\n  parts={message.parts}\n/>',
  'const slot = content + (group ? 20 : 8);\nindex.append(slot);',
];

const FILES = [
  { path: 'src/screens/Chat.tsx', line: 120 },
  { path: 'src/screens/Chat.tsx', line: 214 },
  { path: 'src/heightIndex.ts', line: 1 },
  { path: 'src/chat.ts', line: 198 },
  { path: 'src/scroller.ts', line: 478 },
  { path: 'packages/platform/src/primitives/ChatMessage.tsx', line: 67 },
];

const READ_PATHS = [
  'src/screens/Chat.tsx',
  'src/chat.ts',
  'src/heightIndex.ts',
  'src/scroller.ts',
  'packages/platform/src/primitives/ChatMessage.tsx',
  'packages/platform/src/primitives/Markdown.tsx',
];

const EDIT_INPUT =
  '@@ -118,3 +118,5 @@\n-  const layout = createMemo(() => layoutChat(messages(), width));\n+  const heights = createMemo(() => book.sync(messages(), width));\n+  const anchor = book.indexAt(scroller.offset());';

const lcg = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const pad = (value: number) => String(value).padStart(2, '0');

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

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]!;
}

function filePart(random: () => number): ChatPart {
  const file = pick(random, FILES);
  return { type: 'file', path: file.path, line: file.line };
}

function toolPart(random: () => number): ChatPart {
  const kind = Math.floor(random() * 4);
  const durationMs = 4 + Math.floor(random() * 900);
  if (kind === 0) {
    const path = pick(random, READ_PATHS);
    const lines = 40 + Math.floor(random() * 420);
    return {
      type: 'tool',
      name: 'Read',
      status: 'done',
      title: path,
      output: `  1  /** The ${lines}-line file */\n  ⋮\n${lines}  }\n\nRead ${lines} lines.`,
      durationMs,
    };
  }
  if (kind === 1) {
    const file = pick(random, FILES);
    return {
      type: 'tool',
      name: 'Edit',
      status: 'done',
      title: `${file.path}:${file.line}`,
      input: EDIT_INPUT,
      output: 'Applied 1 edit. +2 −1.',
      durationMs,
    };
  }
  if (kind === 2) {
    const command =
      random() < 0.5 ? 'node --test src/scroller.test.ts' : 'npx tsc --noEmit';
    return {
      type: 'tool',
      name: 'Bash',
      status: 'done',
      title: command,
      output: command.startsWith('node')
        ? '# tests 12\n# pass 12\n# fail 0'
        : 'No errors.',
      durationMs,
    };
  }
  const query = pick(random, [
    'height index',
    'layoutChat',
    'onLayout',
    'scroll offset',
    'prefix scan',
  ]);
  const matches = 2 + Math.floor(random() * 5);
  return {
    type: 'tool',
    name: 'Search',
    status: 'done',
    title: query,
    output: `src/heightIndex.ts:1\nsrc/screens/Chat.tsx:214\nsrc/chat.ts:198\n\n${matches} matches in 3 files.`,
    durationMs,
  };
}

function assistantParts(random: () => number, final: boolean): ChatPart[] {
  if (!final) {
    const parts: ChatPart[] = [
      { type: 'markdown', text: pick(random, WORKING) },
      toolPart(random),
    ];
    if (random() < 0.3) parts.push(filePart(random));
    return parts;
  }
  const parts: ChatPart[] = [{ type: 'markdown', text: pick(random, FINALS) }];
  const roll = random();
  if (roll < 0.24) {
    parts.push({
      type: 'code',
      text: pick(random, SNIPPETS),
      language: 'ts',
    });
  } else if (roll < 0.46) {
    parts.push(filePart(random));
  } else if (roll < 0.6) {
    parts.push(toolPart(random));
  }
  return parts;
}

/** 10,000 messages and their date rows, in time order. */
export function generateChat(count = 10000): ChatItem[] {
  const random = lcg(0x5eed1e);
  const out: ChatItem[] = [];
  // 20 October 2026, 08:12 local time.
  let at = new Date(2026, 9, 20, 8, 12, 0).getTime();
  let id = 0;
  let assistantLeft = 0;
  let promptIndex = 0;
  let lastAt = at;
  for (let i = 0; i < count; i++) {
    const user = assistantLeft === 0;
    at += user
      ? 20_000 + Math.floor(random() * 190_000)
      : 4_000 + Math.floor(random() * 55_000);
    if (i === 0 || !sameDay(lastAt, at)) {
      out.push({ kind: 'date', id: id++, label: dateLabel(at) });
    }
    if (user) {
      out.push({
        kind: 'message',
        id: id++,
        role: 'user',
        author: 'You',
        at,
        parts: [
          { type: 'markdown', text: PROMPTS[promptIndex++ % PROMPTS.length]! },
        ],
      });
      assistantLeft = 1 + Math.floor(random() * 3);
    } else {
      assistantLeft--;
      out.push({
        kind: 'message',
        id: id++,
        role: 'assistant',
        author: AGENT,
        at,
        parts: assistantParts(random, assistantLeft === 0),
      });
    }
    lastAt = at;
  }
  return out;
}

// ---- Height estimates ---------------------------------------------------

const DATE_HEIGHT = 44;
const GROUP_GAP = 20;
const SAME_GAP = 8;
const PART_GAP = 8;
const TEXT_LINE = 21;
const CODE_LINE = 19;

/** The widest a user bubble may be. */
export function maxBubbleWidth(width: number, margin: number): number {
  return Math.max(96, Math.min(430, width - 2 * margin - 48));
}

/** A content-sized user bubble: the longest line, capped, with padding. */
export function userBubbleWidth(message: Message, maximum: number): number {
  let longest = 0;
  for (const part of message.parts) {
    const text =
      part.type === 'markdown' || part.type === 'code'
        ? part.text
        : part.type === 'file'
          ? part.path
          : (part.title ?? '');
    for (const line of text.split('\n')) {
      if (line.length > longest) longest = line.length;
    }
  }
  return Math.max(96, Math.min(maximum, longest * 7.7 + 30));
}

/** Wrapped lines for plain text at `width`; conservative by design. */
function lineCount(text: string, width: number, charWidth: number): number {
  const columns = Math.max(8, Math.floor(width / charWidth));
  let lines = 0;
  for (const line of text.split('\n')) {
    lines += Math.max(1, Math.ceil((line.length || 1) / columns));
  }
  return lines;
}

function markdownHeight(text: string, width: number): number {
  const blocks = text.split(/\n[ \t]*\n/);
  let height = 0;
  for (const block of blocks) {
    const heading = /^#{1,6}\s/.test(block);
    const size = heading ? 20 : 15;
    const lineHeight = heading ? 28 : TEXT_LINE;
    const lines = block.split('\n');
    height += lineCount(block, width, size * 0.54) * lineHeight;
    // A list row carries a 6-unit gap the line count cannot see.
    let rows = 0;
    for (const line of lines) {
      if (/^\s*(?:[-*+]|\d+[.)])\s/.test(line)) rows++;
    }
    if (rows > 1) height += (rows - 1) * 6;
  }
  return height + Math.max(0, blocks.length - 1) * 10;
}

function partHeight(part: ChatPart, width: number): number {
  switch (part.type) {
    case 'markdown':
      return markdownHeight(part.text, width);
    case 'code':
      return lineCount(part.text, width - 24, 7.6) * CODE_LINE + 20;
    case 'file':
      return 30;
    case 'tool': {
      // The collapsed card: padding, the name row, and the one-line title.
      let height = 64;
      if (part.expanded === true) {
        const detail = part.output ?? part.input ?? '';
        height += lineCount(detail, width - 24, 7.6) * 16 + 20;
      }
      return height;
    }
  }
}

/** A conservative content height for a message, before it is measured. */
export function estimateContent(
  message: Message,
  width: number,
  margin: number,
): number {
  let height = 0;
  if (message.role === 'user') {
    const bubble = userBubbleWidth(message, maxBubbleWidth(width, margin));
    const bodyWidth = bubble - 24;
    for (const part of message.parts) height += partHeight(part, bodyWidth);
    height += Math.max(0, message.parts.length - 1) * PART_GAP;
    height += 20; // the bubble's 10-unit top and bottom padding
    // Estimates are deliberately generous so an unmeasured row never paints
    // over the next one. A measured row replaces this exactly.
    return Math.ceil(height * 1.05) + 8;
  }
  const bodyWidth = width - 2 * margin;
  for (const part of message.parts) height += partHeight(part, bodyWidth);
  height += Math.max(0, message.parts.length - 1) * PART_GAP;
  height += 18 + 8; // author/time row and the root gap
  return Math.ceil(height * 1.05) + 8;
}

/**
 * The slot gap after item `index`: date rows are followed immediately, a
 * message is 20 units after a sender change and 8 inside a group.
 */
function gapAt(items: readonly ChatItem[], index: number): number {
  const item = items[index];
  if (item === undefined || item.kind === 'date') return 0;
  const previous = items[index - 1];
  if (previous === undefined || previous.kind === 'date') return GROUP_GAP;
  return previous.author === item.author ? SAME_GAP : GROUP_GAP;
}

/**
 * The index's view of a transcript: estimates for every item, exact heights
 * for the ones that have measured. Appends extend the index; a width change
 * rebuilds it from estimates. The list republishes its window when `sync` or
 * `measure` reports a change.
 */
export class ChatHeights {
  index = new HeightIndex();
  width = 0;
  margin = 0;
  private gaps: number[] = [];
  private items: readonly ChatItem[] = [];

  constructor(items: readonly ChatItem[], width: number, margin: number) {
    this.width = width;
    this.margin = margin;
    this.rebuild(items);
  }

  get count(): number {
    return this.items.length;
  }

  item(index: number): ChatItem | undefined {
    return this.items[index];
  }

  slot(index: number): number {
    return this.index.get(index);
  }

  offsetOf(index: number): number {
    return this.index.offsetOf(index);
  }

  indexAt(offset: number): number {
    return this.index.indexAt(offset);
  }

  total(): number {
    return this.index.total();
  }

  /** Stores a measured message height (without its trailing gap). */
  measure(index: number, content: number): boolean {
    if (!(content > 24) || !Number.isFinite(content) || content > 12_000) {
      return false;
    }
    if (index < 0 || index >= this.gaps.length) return false;
    return this.index.set(index, content + this.gaps[index]!);
  }

  /**
   * Brings the index up to date with `items`. Appends are O(1) per new row;
   * a new width (or a shorter transcript) rebuilds from estimates.
   */
  sync(items: readonly ChatItem[], width: number, margin: number): boolean {
    if (
      width !== this.width ||
      margin !== this.margin ||
      items.length < this.items.length
    ) {
      this.width = width;
      this.margin = margin;
      this.rebuild(items);
      return true;
    }
    if (items.length === this.items.length) {
      this.items = items;
      return false;
    }
    const previous = this.items.length;
    this.items = items;
    for (let i = previous; i < items.length; i++) {
      const gap = gapAt(items, i);
      this.gaps.push(gap);
      this.index.append(this.estimateSlot(items[i]!, gap));
    }
    return true;
  }

  private rebuild(items: readonly ChatItem[]): void {
    this.items = items;
    this.gaps = new Array(items.length);
    const slots = new Array<number>(items.length);
    for (let i = 0; i < items.length; i++) {
      const gap = gapAt(items, i);
      this.gaps[i] = gap;
      slots[i] = this.estimateSlot(items[i]!, gap);
    }
    this.index = new HeightIndex(slots);
  }

  private estimateSlot(item: ChatItem, gap: number): number {
    if (item.kind === 'date') return DATE_HEIGHT + gap;
    return estimateContent(item, this.width, this.margin) + gap;
  }
}
