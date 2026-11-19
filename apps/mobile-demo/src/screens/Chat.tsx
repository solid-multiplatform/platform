/** The 10,000-message chat: a virtual window, momentum, composer, meter. */
import { createEffect, createMemo, For, Show, untrack } from 'solid-js';
import { TextField, useViewport } from '@solid-multiplatform/platform/app';
import {
  firstVisible,
  formatTime,
  layoutChat,
  type ChatLayoutItem,
} from '../chat';
import type { createChatState } from '../state';
import { C, initials, type Metrics } from '../theme';

type ChatState = ReturnType<typeof createChatState>;

const TYPING_H = 72;

function DateRow(props: {
  entry: ChatLayoutItem;
  width: number;
  margin: number;
  offset: number;
}) {
  const label = () =>
    props.entry.item.kind === 'date' ? props.entry.item.label : '';
  const center = () => props.width / 2;
  return (
    <view
      y={props.entry.y - props.offset}
      width={props.width}
      height={props.entry.h}
    >
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
  entry: ChatLayoutItem;
  width: number;
  margin: number;
  offset: number;
}) {
  const item = () =>
    props.entry.item.kind === 'message' ? props.entry.item : undefined;
  const mine = () => item()?.mine === true;
  const y = () => props.entry.y - props.offset;
  const bubbleX = () =>
    mine() ? props.width - props.margin - props.entry.w : props.margin + 44;
  const code = () => item()?.layout === 'code';
  const textColor = () => (mine() ? C.onAccent : C.text);

  return (
    <view y={y()} width={props.width} height={props.entry.h}>
      <Show when={!mine() && props.entry.group && item()}>
        <view
          x={props.margin}
          y={2}
          width={34}
          height={34}
          color={C.surfaceHigh}
          borderRadius={17}
          border={{ width: 1, color: C.line }}
        >
          <text
            y={8}
            width={34}
            contain="width"
            textAlign="center"
            fontSize={12}
            color={C.muted}
          >
            {initials(item()!.author)}
          </text>
        </view>
      </Show>
      <view
        x={bubbleX()}
        y={0}
        width={props.entry.w}
        height={props.entry.h}
        color={
          code()
            ? mine()
              ? 0x8a3b2eff
              : C.surfaceHigh
            : mine()
              ? C.bubbleMe
              : C.bubbleThem
        }
        borderRadius={18}
        border={
          code() ? { width: 1, color: mine() ? 0xffffff22 : C.line } : undefined
        }
      >
        <text
          x={13}
          y={code() ? 12 : 10}
          width={props.entry.w - 26}
          contain="width"
          fontSize={code() ? 13 : 15}
          lineHeight={code() ? 19 : 21}
          color={textColor()}
        >
          {item()?.text ?? ''}
        </text>
        <text
          x={props.entry.w - 50}
          y={props.entry.h - 17}
          width={38}
          contain="width"
          textAlign="right"
          fontSize={10}
          color={mine() ? 0xfff4f0aa : C.dim}
        >
          {item() ? formatTime(item()!.at) : ''}
        </text>
      </view>
    </view>
  );
}

function TypingRow(props: { y: number; width: number; margin: number }) {
  return (
    <view y={props.y} width={props.width} height={44}>
      <view
        x={props.margin}
        y={2}
        width={34}
        height={34}
        color={C.surfaceHigh}
        borderRadius={17}
        border={{ width: 1, color: C.line }}
      >
        <text
          y={8}
          width={34}
          contain="width"
          textAlign="center"
          fontSize={12}
          color={C.muted}
        >
          MC
        </text>
      </view>
      <view
        x={props.margin + 44}
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
  const layout = createMemo(() => layoutChat(props.chat.messages(), m().width));
  const total = () => layout().total + (props.chat.typing() ? TYPING_H : 0);

  let firstRun = true;
  let lastJump = 0;
  createEffect(() => {
    const height = viewH();
    const content = total();
    const jump = props.chat.jump();
    void props.chat.messages();
    untrack(() => {
      const scroller = props.chat.scroller;
      const wasBottom = firstRun || scroller.offset() >= scroller.max() - 30;
      scroller.layout(content, height);
      if (firstRun || wasBottom || jump !== lastJump) {
        scroller.to(scroller.max(), firstRun ? 0 : 240);
      }
      firstRun = false;
      lastJump = jump;
    });
  });

  const visible = createMemo(() => {
    const offset = props.chat.scroller.offset();
    const end = offset + viewH() + 260;
    const items = layout().items;
    const start = firstVisible(items, offset);
    const out: ChatLayoutItem[] = [];
    for (let index = start; index < items.length; index++) {
      const entry = items[index]!;
      if (entry.y > end) break;
      out.push(entry);
      if (out.length > 40) break;
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
        onPointerDrag={(phase, point, origin) =>
          props.chat.scroller.drag(phase, point, origin)
        }
      >
        <For each={visible()}>
          {(entry) =>
            entry.item.kind === 'date' ? (
              <DateRow
                entry={entry}
                width={m().width}
                margin={m().margin}
                offset={props.chat.scroller.offset()}
              />
            ) : (
              <MessageRow
                entry={entry}
                width={m().width}
                margin={m().margin}
                offset={props.chat.scroller.offset()}
              />
            )
          }
        </For>
        <Show when={props.chat.typing()}>
          <TypingRow
            y={layout().total + 4 - props.chat.scroller.offset()}
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
          onMouseClick={() =>
            props.chat.scroller.to(props.chat.scroller.max(), 420)
          }
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
          Design crew
        </text>
        <text y={23} fontSize={11} color={C.dim}>
          10,000 messages · only the visible window is mounted
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
