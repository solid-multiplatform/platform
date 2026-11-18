import { createSignal, createEffect, onCleanup, For } from 'solid-js';
import { getRenderer } from '../index.js';
import type { EditorOptions } from './editor.js';
import type { Rect } from './input.js';

interface EditState {
  display: string;
  caret: number;
  selectionStart: number;
  selectionEnd: number;
  composition: string;
  focused: boolean;
}
interface Session {
  value(): string;
  setValue(value: string): void;
  focus(): void;
  blur(): void;
  select(start: number, end?: number): void;
  setBounds(rect: Rect): void;
  dispose(): void;
}
export interface DesktopFieldHost {
  editors: {
    createEditor(
      options: EditorOptions & { onState(state: EditState): void },
    ): Session;
  };
  semantics?: {
    register(node: {
      role: string;
      label: string;
      value?: string;
      bounds(): Rect;
      focus(): void;
      activate(): void;
    }): { dispose(): void; update(node: object): void; focus?(): void };
  };
}
export function DesktopTextField(
  props: EditorOptions & {
    host: DesktopFieldHost;
    bounds: Rect;
    fontFamily: string;
    fontSize?: number;
    ref?: (session: Session) => void;
  },
) {
  const secret = props.purpose?.endsWith('password') ?? false;
  const masked = (s: string) =>
    secret ? '•'.repeat([...new Intl.Segmenter().segment(s)].length) : s;
  const [state, setState] = createSignal<EditState>({
    display: masked(props.value ?? ''),
    caret: 0,
    selectionStart: 0,
    selectionEnd: 0,
    composition: '',
    focused: false,
  });
  const field = props.host.editors.createEditor({
    ...props,
    onChange: (s) => props.onChange(s),
    onState: setState,
  });
  const font = () => props.fontSize ?? 18,
    lineHeight = () => font() * 1.35;
  const lines = () => state().display.split('\n');
  const cursor = () => {
    const before = state().display.slice(0, state().caret).split('\n');
    return { row: before.length - 1, column: before.at(-1)!.length };
  };
  const measure = (text: string) => {
    const renderer = getRenderer() as unknown as {
      measureText(p: object): { w: number } | null;
    };
    return (
      renderer.measureText({
        text,
        fontFamily: props.fontFamily,
        fontSize: font(),
        maxLines: 1,
      })?.w ?? 0
    );
  };
  const caretX = () =>
    measure(lines()[cursor().row]?.slice(0, cursor().column) ?? '');
  const scrollX = () => Math.max(0, caretX() - props.bounds.width + 18);
  const scrollY = () =>
    Math.max(0, (cursor().row + 1) * lineHeight() - props.bounds.height + 12);
  const rect = () => props.bounds;
  const node = {
    role: secret ? 'password' : props.multiline ? 'multiline' : 'input',
    label: props.label,
    bounds: rect,
    focus: () => field.focus(),
    activate: () => field.focus(),
  };
  const semantics = props.host.semantics?.register(node);
  function indexAt(point: { x: number; y: number }) {
    const raw = field.value().split('\n');
    const row = Math.max(
      0,
      Math.min(
        raw.length - 1,
        Math.floor((point.y - rect().y - 4 + scrollY()) / lineHeight()),
      ),
    );
    const line = raw[row]!,
      x = point.x - rect().x - 6 + scrollX();
    let index = line.length;
    for (const segment of new Intl.Segmenter().segment(line)) {
      const start = measure(masked(line.slice(0, segment.index)));
      const end = measure(
        masked(line.slice(0, segment.index + segment.segment.length)),
      );
      if (x < (start + end) / 2) {
        index = segment.index;
        break;
      }
    }
    return raw.slice(0, row).reduce((n, l) => n + l.length + 1, 0) + index;
  }
  createEffect(() => {
    field.setBounds({ ...props.bounds });
    if (props.value !== undefined) field.setValue(props.value);
  });
  createEffect(() => {
    const s = state();
    semantics?.update({ ...node, value: s.display });
    if (s.focused) semantics?.focus?.();
  });
  props.ref?.(field);
  onCleanup(() => {
    semantics?.dispose();
    field.dispose();
  });
  return (
    <view
      x={rect().x}
      y={rect().y}
      width={rect().width}
      height={rect().height}
      clipping
      color={state().focused ? 0x293c52ff : 0x1b2736ff}
      cursorStyle="text"
      onFocus={() => field.focus()}
      onMouseClick={(point) => {
        field.focus();
        field.select(indexAt(point));
      }}
      onPointerDrag={(phase, point, origin) => {
        if (phase === 'start') field.focus();
        if (phase !== 'cancel') field.select(indexAt(origin), indexAt(point));
      }}
    >
      <For each={lines()}>
        {(line, index) => {
          const start = () =>
            lines()
              .slice(0, index())
              .reduce((n, l) => n + l.length + 1, 0);
          const left = () =>
            measure(
              line.slice(0, Math.max(0, state().selectionStart - start())),
            );
          const right = () =>
            measure(line.slice(0, Math.max(0, state().selectionEnd - start())));
          return (
            <view
              x={6 - scrollX()}
              y={4 + index() * lineHeight() - scrollY()}
              width={Math.max(rect().width, measure(line))}
              height={lineHeight()}
            >
              <view
                x={left()}
                width={Math.max(0, right() - left())}
                height={lineHeight()}
                color={0x345e91ff}
              />
              <text
                fontFamily={props.fontFamily}
                fontSize={font()}
                color={0xffffffff}
              >
                {line}
              </text>
            </view>
          );
        }}
      </For>
      <view
        x={6 + caretX() - scrollX()}
        y={4 + cursor().row * lineHeight() - scrollY()}
        width={1}
        height={lineHeight()}
        color={0xffffffff}
        alpha={state().focused ? 1 : 0}
      />
    </view>
  );
}
