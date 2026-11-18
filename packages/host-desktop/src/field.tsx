// A text field drawn in the scene: the text, the selection behind it, a line
// under what an input method is composing, and the caret. `editor.ts` owns
// what is shown; this file only draws it and answers where a point falls.
//
// Fields live in one layer above the app's scene, as a page's `<input>`s
// live above a canvas. The caret does not blink: a blink is a timer, and an
// idle scene runs none.
import { createRoot, createSignal, For } from 'solid-js';
import {
  Config,
  createElement,
  getRenderer,
  insertNode,
  rootNode,
  type ElementNode,
} from '@solid-multiplatform/platform';
import type { Point, Rect } from '@solid-multiplatform/platform/input';
import type { FieldState } from './editor.js';

/** How fields look. Colours are 0xRRGGBBAA, as in the scene. */
export interface FieldStyle {
  /** Defaults to the app's `Config.fontSettings.fontFamily`. */
  fontFamily?: string;
  /** Defaults to half the field's height, between 12 and 28. */
  fontSize?: number;
  color?: number;
  background?: number;
  focusedBackground?: number;
  selectionColor?: number;
  caretColor?: number;
  /** Space left and right of the text. Default 6. */
  padding?: number;
  /** Where the fields' layer sorts among the scene's top nodes. */
  zIndex?: number;
}

export interface FieldView {
  update(state: FieldState): void;
  place(rect: Rect): void;
  /** The offset in the text nearest to a point of the scene. */
  offsetAt(point: Point, rect: Rect): number;
  dispose(): void;
}

interface Mount {
  state: FieldState;
  multiline: boolean;
  style: FieldStyle;
  /** An offset into what is shown as an offset into the text. */
  toText(offset: number): number;
  /** The caret is `x` units from the field's left edge. */
  caretMoved(x: number): void;
}

interface Measurer {
  measureText(props: {
    text: string;
    fontFamily: string;
    fontSize: number;
  }): { w: number } | null;
  on(event: 'idle', listener: () => void): void;
  off(event: 'idle', listener: () => void): void;
}

let layer: ElementNode | undefined;
let mounted = 0;

/** The layer all fields are drawn in, made with the first of them. */
function fieldLayer(zIndex: number): ElementNode {
  if (layer === undefined) {
    const node = createElement('node') as ElementNode;
    node.zIndex = zIndex;
    insertNode(rootNode, node);
    layer = node;
  }
  return layer;
}

export function mountField(mount: Mount): FieldView {
  const style = mount.style;
  const padding = style.padding ?? 6;
  const [state, setState] = createSignal(mount.state);
  const [rect, setRect] = createSignal<Rect>({
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  });
  // Bumped when a font arrives, so that what was measured as nothing is
  // measured again.
  const [fonts, setFonts] = createSignal(0);

  const family = (): string =>
    style.fontFamily ?? String(Config.fontSettings.fontFamily ?? '');
  const fontSize = (): number =>
    style.fontSize ?? Math.max(12, Math.min(28, Math.round(rect().height / 2)));
  const lineHeight = (): number => Math.round(fontSize() * 1.35);

  let waiting = false;
  const remeasure = (): void => {
    waiting = false;
    (getRenderer() as unknown as Measurer).off('idle', remeasure);
    setFonts((n) => n + 1);
  };
  /** The width of `text` on one line; 0 until its font has loaded. */
  const measure = (text: string): number => {
    fonts();
    if (text === '') return 0;
    const renderer = getRenderer() as unknown as Measurer;
    // A trailing space has an advance but no ink, and a layout's width may
    // stop at the ink: measured with a mark after it, less the mark.
    const mark = text.endsWith(' ') ? '|' : '';
    const props = { fontFamily: family(), fontSize: fontSize() };
    const measured = renderer.measureText({ ...props, text: text + mark });
    if (measured === null) {
      // The font is still loading. The frame that draws its text ends in an
      // `idle` event: measure again then. No frame, no event.
      if (!waiting) {
        waiting = true;
        renderer.on('idle', remeasure);
      }
      return 0;
    }
    if (mark === '') return measured.w;
    return (
      measured.w - (renderer.measureText({ ...props, text: mark })?.w ?? 0)
    );
  };

  const lines = (): string[] =>
    mount.multiline ? state().display.split('\n') : [state().display];
  /** The offset at which each line starts in what is shown. */
  const starts = (): number[] => {
    const result: number[] = [];
    let at = 0;
    for (const line of lines()) {
      result.push(at);
      at += line.length + 1;
    }
    return result;
  };
  const caretRow = (): number => {
    const offsets = starts();
    let row = 0;
    while (row + 1 < offsets.length && offsets[row + 1]! <= state().caret)
      row++;
    return row;
  };
  const caretX = (): number => {
    const row = caretRow();
    return measure(lines()[row]!.slice(0, state().caret - starts()[row]!));
  };
  // The text scrolls so that the caret stays in view.
  const scrollX = (): number =>
    Math.max(0, caretX() - (rect().width - 2 * padding - 2));
  const top = (): number =>
    mount.multiline ? 4 : Math.max(0, (rect().height - lineHeight()) / 2);
  const scrollY = (): number =>
    mount.multiline
      ? Math.max(0, (caretRow() + 1) * lineHeight() + 2 * top() - rect().height)
      : 0;
  /** The part of line `row` between two offsets, as x and width. */
  const span = (row: number, from: number, to: number): [number, number] => {
    const line = lines()[row]!;
    const start = starts()[row]!;
    const a = Math.max(0, Math.min(line.length, from - start));
    const b = Math.max(0, Math.min(line.length, to - start));
    if (b <= a) return [0, 0];
    const x = measure(line.slice(0, a));
    return [x, measure(line.slice(0, b)) - x];
  };

  let node!: ElementNode;
  const dispose = createRoot((disposeRoot) => {
    node = (
      <view
        x={rect().x}
        y={rect().y}
        width={rect().width}
        height={rect().height}
        clipping
        color={
          state().focused
            ? (style.focusedBackground ?? 0x293c52ff)
            : (style.background ?? 0x1b2736ff)
        }
      >
        <For each={lines()}>
          {(line, row) => (
            <view
              x={padding - scrollX()}
              y={top() + row() * lineHeight() - scrollY()}
              height={lineHeight()}
            >
              <view
                x={span(row(), state().selectionStart, state().selectionEnd)[0]}
                width={
                  span(row(), state().selectionStart, state().selectionEnd)[1]
                }
                height={lineHeight()}
                color={style.selectionColor ?? 0x345e91ff}
              />
              <text
                fontFamily={family()}
                fontSize={fontSize()}
                lineHeight={lineHeight()}
                color={style.color ?? 0xffffffff}
              >
                {line}
              </text>
              <view
                x={
                  span(
                    row(),
                    state().compositionStart,
                    state().compositionEnd,
                  )[0]
                }
                y={lineHeight() - 3}
                width={
                  span(
                    row(),
                    state().compositionStart,
                    state().compositionEnd,
                  )[1]
                }
                height={1}
                color={style.color ?? 0xffffffff}
              />
            </view>
          )}
        </For>
        <view
          x={padding + caretX() - scrollX()}
          y={top() + caretRow() * lineHeight() - scrollY()}
          // No width without the keyboard: the caret is not drawn.
          width={state().focused ? 1 : 0}
          height={lineHeight()}
          color={style.caretColor ?? 0xffffffff}
        />
      </view>
    ) as unknown as ElementNode;
    return disposeRoot;
  });
  // Fields are not part of the app's focus tree: the keyboard reaches them
  // through the editor host.
  insertNode(fieldLayer(style.zIndex ?? 10000), node);
  mounted++;

  // The caret's place in the field, for the input method's window.
  const reportCaret = (): void =>
    mount.caretMoved(padding + caretX() - scrollX());

  return {
    update(next) {
      setState(next);
      reportCaret();
    },
    place(next) {
      setRect({ ...next });
      reportCaret();
    },
    offsetAt(point, bounds) {
      const all = lines();
      const y = point.y - bounds.y - top() + scrollY();
      const row = Math.max(
        0,
        Math.min(all.length - 1, Math.floor(y / lineHeight())),
      );
      const line = all[row]!;
      const x = point.x - bounds.x - padding + scrollX();
      // The boundary whose x is nearest: widths grow with the offset, so the
      // search halves the line each step.
      const stops = __solid.text!.graphemes(line);
      let low = 0;
      let high = stops.length - 1;
      while (low < high) {
        const middle = (low + high) >> 1;
        const left = measure(line.slice(0, stops[middle]!));
        const right = measure(line.slice(0, stops[middle + 1]!));
        if (x < (left + right) / 2) high = middle;
        else low = middle + 1;
      }
      return mount.toText(starts()[row]! + stops[low]!);
    },
    dispose() {
      if (waiting)
        (getRenderer() as unknown as Measurer).off('idle', remeasure);
      dispose();
      node.parent?.removeChild(node);
      node.destroy();
      mounted--;
      // The layer goes with the last field.
      if (mounted === 0 && layer !== undefined) {
        rootNode.removeChild(layer);
        layer.destroy();
        layer = undefined;
      }
    },
  };
}
