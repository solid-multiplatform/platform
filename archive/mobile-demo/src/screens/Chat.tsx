/**
 * The 10,000-message coding-agent chat.
 *
 * The transcript is a list of keyed items (messages and date rows). Heights
 * are estimated once per item, then corrected as messages mount and report
 * their laid-out height through `onLayout`. `ChatHeights` owns a Fenwick tree
 * of slot heights, so the total, an item's offset and the item at an offset
 * cost O(log n). A correction above the first visible item shifts the offset
 * by the same delta; the anchor keeps its screen position and nothing scans
 * the transcript while the list moves.
 *
 * Tool cards are expanded by the app: the expanded part indices live in the
 * chat state, and `ChatMessage` stays a pure function of its props. The list
 * measures the card again after the toggle.
 */
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  untrack,
  type Accessor,
} from 'solid-js';
import { TextField, useViewport } from '@solid-multiplatform/platform/app';
import { ChatMessage } from '@solid-multiplatform/platform/primitives';
import {
  ChatHeights,
  formatTime,
  maxBubbleWidth,
  userBubbleWidth,
  type Message,
} from '../chat';
import { toolKey, type createChatState } from '../state';
import { C, type Metrics } from '../theme';

type ChatState = ReturnType<typeof createChatState>;

/** The typing row plus the space above it, in content coordinates. */
const TYPING_H = 72;
/** How far above and below the viewport rows stay mounted. */
const OVERSCAN = 320;
/** Within this distance the list still counts as pinned to the bottom. */
const BOTTOM_SLACK = 30;

function DateRow(props: {
  index: number;
  book: ChatHeights;
  width: number;
  margin: number;
  offset: Accessor<number>;
  geometry: Accessor<number>;
}) {
  const label = () => {
    const item = props.book.item(props.index);
    return item?.kind === 'date' ? item.label : '';
  };
  const y = () => {
    props.geometry();
    return props.book.offsetOf(props.index) - props.offset();
  };
  const center = () => props.width / 2;
  return (
    <view y={y()} width={props.width} height={44}>
      <view
        x={props.margin}
        y={21}
        width={center() - props.margin - 62}
        height={1}
        color={C.lineSoft}
      />
      <text
        x={center() - 62}
        y={11}
        width={124}
        contain="width"
        textAlign="center"
        fontSize={10}
        letterSpacing={0.9}
        color={C.dim}
      >
        {label().toUpperCase()}
      </text>
      <view
        x={center() + 62}
        y={21}
        width={props.width - props.margin - center() - 62}
        height={1}
        color={C.lineSoft}
      />
    </view>
  );
}

function MessageRow(props: {
  index: number;
  book: ChatHeights;
  width: number;
  margin: number;
  offset: Accessor<number>;
  geometry: Accessor<number>;
  expanded: Accessor<ReadonlySet<string>>;
  onMeasure(index: number, height: number): void;
  onToggleTool(messageId: number, part: number): void;
}) {
  const item = () => props.book.item(props.index) as Message;
  const mine = () => item().role === 'user';
  const contentWidth = () => props.width - 2 * props.margin;
  const messageWidth = () =>
    mine()
      ? userBubbleWidth(item(), maxBubbleWidth(props.width, props.margin))
      : contentWidth();
  const x = () =>
    mine() ? props.width - props.margin - messageWidth() : props.margin;
  const y = () => {
    props.geometry();
    return props.book.offsetOf(props.index) - props.offset();
  };
  const parts = createMemo(() =>
    item().parts.map((part, index) => {
      if (part.type !== 'tool') return part;
      // Keep the original object when the flag did not change, so a toggle
      // only re-renders the card that moved.
      const expanded = props.expanded().has(toolKey(item().id, index));
      return expanded === (part.expanded === true)
        ? part
        : { ...part, expanded };
    }),
  );

  return (
    <view
      x={x()}
      y={y()}
      width={messageWidth()}
      display="flex"
      flexDirection="column"
      onLayout={(node) => props.onMeasure(props.index, node.height)}
    >
      <ChatMessage
        role={item().role}
        author={mine() ? undefined : item().author}
        time={mine() ? undefined : formatTime(item().at)}
        parts={parts()}
        width={messageWidth()}
        fontSize={15}
        lineHeight={21}
        color={C.text}
        mutedColor={C.muted}
        bubbleColor={C.bubbleMe}
        bubbleTextColor={C.onAccent}
        cardColor={C.surface}
        borderColor={C.line}
        linkColor={C.accent}
        onToolPress={(index) => props.onToggleTool(item().id, index)}
      />
    </view>
  );
}

function TypingRow(props: {
  y: number;
  width: number;
  margin: number;
  offset: Accessor<number>;
}) {
  const top = () => props.y - props.offset();
  return (
    <view y={top()} width={props.width} height={44}>
      <view
        x={props.margin}
        y={0}
        width={66}
        height={38}
        color={C.bubbleThem}
        borderRadius={18}
      >
        <view
          x={14}
          y={16}
          width={6}
          height={6}
          borderRadius={3}
          color={0xffffffaa}
        />
        <view
          x={28}
          y={16}
          width={6}
          height={6}
          borderRadius={3}
          color={0xffffff77}
        />
        <view
          x={42}
          y={16}
          width={6}
          height={6}
          borderRadius={3}
          color={0xffffff44}
        />
      </view>
    </view>
  );
}

export function Chat(props: { chat: ChatState; metrics: Metrics }) {
  const vp = useViewport;
  const m = () => props.metrics;
  const keyboard = () => vp().keyboardInset;
  const inputY = () => m().height - m().bottom - m().inputH - keyboard();
  const listTop = () => m().contentY + 46;
  const listBottom = () => inputY() - 8;
  const viewH = () => Math.max(120, listBottom() - listTop());

  const book = new ChatHeights(props.chat.messages(), m().width, m().margin);
  const [geometry, setGeometry] = createSignal(0);
  // Layout reports arrive one per message inside the renderer's post-mutation
  // microtask. Publish them in one microtask of our own so a batch of
  // measurements is a single window recomputation, not one per message.
  let geometryQueued = false;
  const notifyGeometry = () => {
    if (geometryQueued) return;
    geometryQueued = true;
    queueMicrotask(() => {
      geometryQueued = false;
      setGeometry((value) => value + 1);
    });
  };

  // Appends extend the index in O(1) per row; a width change rebuilds it.
  // Nothing here runs on a scroll.
  createEffect(() => {
    const items = props.chat.messages();
    const width = m().width;
    const margin = m().margin;
    untrack(() => {
      if (book.sync(items, width, margin)) notifyGeometry();
    });
  });

  const contentHeight = () => {
    geometry();
    return book.total();
  };
  const total = () => contentHeight() + (props.chat.typing() ? TYPING_H : 0);

  let firstRun = true;
  let lastJump = 0;
  // A send or a "Latest" press glides to the bottom. Keep re-targeting while
  // the geometry settles so a measurement cannot leave the glide aiming at
  // an old maximum; a drag cancels it.
  let followBottom = false;
  createEffect(() => {
    const height = viewH();
    const content = total();
    const jump = props.chat.jump();
    untrack(() => {
      const scroller = props.chat.scroller;
      const wasBottom =
        firstRun || scroller.offset() >= scroller.max() - BOTTOM_SLACK;
      const keepBottom = wasBottom || followBottom;
      scroller.layout(content, height, keepBottom ? 'bottom' : undefined);
      if (firstRun) {
        scroller.to(scroller.max(), 0);
        followBottom = false;
      } else if (jump !== lastJump) {
        followBottom = true;
        scroller.to(scroller.max(), 240);
      } else if (followBottom) {
        scroller.to(scroller.max(), 240);
      }
      firstRun = false;
      lastJump = jump;
    });
  });

  /**
   * A mounted message reported its real height. Keep the first visible item
   * where it is: a change above it moves every later offset by the same
   * delta, so shifting the scroll offset by that delta is exact. At the
   * bottom the list stays pinned instead.
   */
  const measure = (index: number, height: number) => {
    const scroller = props.chat.scroller;
    const offset = scroller.offset();
    const anchor = book.indexAt(offset);
    const anchorOffset = book.offsetOf(anchor);
    const wasBottom = scroller.max() - offset <= BOTTOM_SLACK;
    if (!book.measure(index, height)) return;
    const content = book.total() + (props.chat.typing() ? TYPING_H : 0);
    const keepBottom = wasBottom || followBottom;
    scroller.layout(content, viewH(), keepBottom ? 'bottom' : undefined);
    if (!keepBottom && index < anchor) {
      const delta = book.offsetOf(anchor) - anchorOffset;
      if (delta !== 0) scroller.shift(delta);
    }
    notifyGeometry();
  };

  const visible = createMemo(() => {
    geometry();
    const offset = props.chat.scroller.offset();
    const start = book.indexAt(Math.max(0, offset - OVERSCAN));
    const end = book.indexAt(offset + viewH() + OVERSCAN);
    const out: number[] = [];
    for (let index = start; index <= end && index < book.count; index++) {
      out.push(index);
    }
    return out;
  });

  const away = () =>
    props.chat.scroller.max() - props.chat.scroller.offset() > 180;
  const thumbH = () => {
    const height = viewH();
    const content = Math.max(height, total());
    return Math.max(44, (height * height) / content);
  };
  const thumbY = () => {
    const max = props.chat.scroller.max();
    const track = viewH() - thumbH();
    if (max <= 0) return 0;
    return (props.chat.scroller.offset() / max) * track;
  };

  return (
    <view
      x={0}
      y={0}
      width={m().width}
      height={m().height}
      color={C.background}
    >
      <view
        x={0}
        y={listTop()}
        width={m().width}
        height={viewH()}
        clipping
        onPointerDrag={(phase, point, origin) => {
          if (phase === 'start') followBottom = false;
          props.chat.scroller.drag(phase, point, origin);
        }}
      >
        <For each={visible()}>
          {(index) => {
            const item = book.item(index);
            if (item === undefined) return null;
            return item.kind === 'date' ? (
              <DateRow
                index={index}
                book={book}
                width={m().width}
                margin={m().margin}
                offset={props.chat.scroller.offset}
                geometry={geometry}
              />
            ) : (
              <MessageRow
                index={index}
                book={book}
                width={m().width}
                margin={m().margin}
                offset={props.chat.scroller.offset}
                geometry={geometry}
                expanded={props.chat.expandedTools}
                onMeasure={measure}
                onToggleTool={props.chat.toggleTool}
              />
            );
          }}
        </For>
        <Show when={props.chat.typing()}>
          <TypingRow
            y={contentHeight() + 4}
            offset={props.chat.scroller.offset}
            width={m().width}
            margin={m().margin}
          />
        </Show>
      </view>

      {/* A visible scrollbar, drawn from offset and content height. The HIG
          has it appear once scrolling begins, so it shows only while the
          list is moving and hides at rest. */}
      <view
        x={m().width - 5}
        y={listTop()}
        width={4}
        height={viewH()}
        color={0xffffff10}
        borderRadius={2}
        alpha={props.chat.scroller.settled() ? 0 : 1}
      />
      <view
        x={m().width - 5}
        y={listTop() + thumbY()}
        width={4}
        height={thumbH()}
        color={0x4a4a52ff}
        borderRadius={2}
        alpha={props.chat.scroller.settled() ? 0 : 1}
      />

      <Show when={away()}>
        <view
          x={m().width - m().margin - 94}
          y={listBottom() - 56}
          width={94}
          height={44}
          color={0x141416f2}
          borderRadius={22}
          border={{ width: 1, color: C.line }}
          onMouseClick={() => {
            followBottom = true;
            props.chat.scroller.to(props.chat.scroller.max(), 420);
          }}
        >
          <text
            y={13}
            width={94}
            contain="width"
            textAlign="center"
            fontSize={13}
            color={C.text}
          >
            Latest
          </text>
        </view>
      </Show>

      <view
        x={m().margin}
        y={m().contentY}
        width={m().width - 2 * m().margin}
        height={44}
      >
        <text fontSize={20} color={C.textPrimary}>
          Claude
        </text>
        <text y={23} fontSize={11} color={C.dim}>
          10,000 messages · measured heights, visible window only
        </text>
      </view>

      <view
        x={0}
        y={inputY()}
        width={m().width}
        height={m().inputH + m().bottom}
        color={C.backgroundRaised}
        zIndex={25}
      >
        <view x={0} y={0} width={m().width} height={1} color={C.lineSoft} />
        <view
          x={m().margin}
          y={8}
          width={m().width - 2 * m().margin - 64}
          height={48}
          color={C.surface}
          borderRadius={24}
          clipping
        >
          <TextField
            label="Message"
            placeholder="Write a message…"
            width={m().width - 2 * m().margin - 64}
            height={48}
            value={props.chat.draft()}
            onChange={props.chat.setDraft}
            onSubmit={(value) => props.chat.send(value)}
          />
        </view>
        <view
          x={m().width - m().margin - 56}
          y={8}
          width={56}
          height={48}
          color={C.accent}
          borderRadius={24}
          alpha={props.chat.draft().trim() ? 1 : 0.45}
          onMouseClick={() => props.chat.send(props.chat.draft())}
        >
          <text
            y={15}
            width={56}
            contain="width"
            textAlign="center"
            fontSize={13}
            color={C.onAccent}
          >
            Send
          </text>
        </view>
      </view>
    </view>
  );
}
