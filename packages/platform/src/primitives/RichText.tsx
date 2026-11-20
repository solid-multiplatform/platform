import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onMount,
  type JSX,
} from 'solid-js';
import { getRenderer } from '../index.js';
import { Config } from '../core/config.js';
import type { ElementNode } from '../core/elementNode.js';
import {
  estimateTextWidth,
  layoutRichText,
  type MeasureRichText,
  type RichTextLayout,
  type RichTextRun,
  type RichTextSpan,
} from '../sdk/richText.js';

export interface RichTextProps {
  x?: number;
  y?: number;
  /** Width available for wrapping. Required. */
  width: number;
  /** Container height. Defaults to the laid-out text height. */
  height?: number;
  spans: readonly RichTextSpan[];
  /** Default font size. Defaults to 24. */
  fontSize?: number;
  /** Default colour (0xRRGGBBAA). Defaults to opaque white. */
  color?: number;
  lineHeight?: number;
  maxLines?: number;
  ellipsis?: boolean;
  align?: 'left' | 'center' | 'right';
  /** Replace the renderer's text measurer, e.g. for deterministic tests. */
  measure?: MeasureRichText;
  /** Called whenever the wrapped layout changes. */
  onLayout?(layout: RichTextLayout): void;
  /**
   * Called when a laid-out run is pressed. Markdown uses it for links: the
   * run's `span` index maps back to the span the caller built.
   */
  onRunPress?(run: RichTextRun): void;
  ref?: (node: ElementNode) => void;
}

const rendererMeasure: MeasureRichText = (text, span) => {
  try {
    const renderer = getRenderer() as unknown as {
      measureText?(props: object): { w: number } | null;
    };
    const measured = renderer?.measureText?.({
      text,
      // The renderer's default is a plain 'sans-serif' with no face; the
      // app's configured family is what its text nodes draw with, so the
      // measurement has to be taken from the same face.
      fontFamily: span.fontFamily ?? Config.fontSettings?.fontFamily,
      fontSize: span.fontSize,
      fontWeight: span.fontWeight,
      letterSpacing: span.letterSpacing,
      maxLines: 1,
    });
    if (measured && Number.isFinite(measured.w) && measured.w > 0) {
      return measured.w;
    }
  } catch {
    // A host without text metrics falls back to the estimate below.
  }
  return estimateTextWidth(text, span.fontSize ?? 24);
};

/**
 * Inline rich text: multiple styled spans flow into wrapped lines.
 *
 * The layout engine measures each span, wraps at the available width, hard
 * breaks over-long words, and renders one `<text>` per run. This is the
 * Flutter `Text.rich` / RN nested `<Text>` shape without a per-platform text
 * backend. Use `onLayout` for the resulting line rectangles.
 */
export function RichText(props: RichTextProps): JSX.Element {
  const [revision, setRevision] = createSignal(0);
  const measure = (text: string, span: RichTextSpan) =>
    (props.measure ?? rendererMeasure)(text, {
      ...span,
      fontSize: span.fontSize ?? props.fontSize ?? 24,
    });

  onMount(() => {
    // SDF/DOM fonts can finish after first paint; reflow once when ready.
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    fonts?.ready.then(() => setRevision((value) => value + 1)).catch(() => {});
  });

  const layout = createMemo(() => {
    revision();
    return layoutRichText(
      props.spans,
      {
        width: props.width,
        fontSize: props.fontSize,
        color: props.color,
        lineHeight: props.lineHeight,
        maxLines: props.maxLines,
        ellipsis: props.ellipsis,
        align: props.align,
      },
      measure,
    );
  });

  createEffect(() => props.onLayout?.(layout()));

  // One click target for the block, not one per run: the point is mapped onto
  // the laid-out line and run, so a paragraph of many styles still costs a
  // single pointer target.
  const press = (event: { x: number; y: number }): void => {
    if (props.onRunPress === undefined) return;
    const laid = layout();
    const localX = event.x - (props.x ?? 0);
    const localY = event.y - (props.y ?? 0);
    for (const line of laid.lines) {
      if (localY < line.y || localY >= line.y + laid.lineHeight) continue;
      for (const run of line.runs) {
        const start = line.x + run.x;
        if (localX >= start && localX < start + run.width) {
          props.onRunPress(run);
          return;
        }
      }
    }
  };

  return (
    <view
      ref={props.ref}
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height ?? layout().height}
      onMouseClick={props.onRunPress === undefined ? undefined : press}
    >
      <For each={layout().lines}>
        {(line) => (
          <Show when={line.runs.length > 0}>
            <For each={line.runs}>
              {(run) => (
                <text
                  x={line.x + run.x}
                  y={line.y}
                  fontSize={run.fontSize}
                  color={run.color}
                  fontWeight={run.fontWeight}
                  fontStyle={run.fontStyle}
                  fontFamily={run.fontFamily}
                  letterSpacing={run.letterSpacing}
                >
                  {run.text}
                </text>
              )}
            </For>
          </Show>
        )}
      </For>
    </view>
  );
}
