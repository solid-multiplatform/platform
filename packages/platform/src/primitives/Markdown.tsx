/**
 * Markdown, rendered into scene nodes.
 *
 * The parse is cached by source (`markdown()`), so scrolling back over a
 * transcript parses nothing; each block is laid out by `RichText`, which
 * measures a span once and shares the renderer's text metrics. Blocks stack
 * in a flex column, so a message's height is whatever its content is — the
 * chat list measures it once and keeps it.
 *
 * Inline styles map onto the scene's text capabilities: strong is weight 700,
 * emphasis is `fontStyle: italic` (an unregistered italic face falls back to
 * the normal one), inline code is a colour plus the code family, links are a
 * colour and a press handler, strikethrough is muted (the scene has no strike
 * line). Code blocks are one background box and one text node.
 */
import { For, type JSX } from 'solid-js';
import { markdown } from '../markdown/index.js';
import type { Block, Inline } from '../markdown/types.js';
import type { RichTextSpan } from '../sdk/richText.js';
import { RichText } from './RichText.jsx';

export interface MarkdownProps {
  source: string;
  width: number;
  x?: number;
  y?: number;
  fontSize?: number;
  color?: number;
  lineHeight?: number;
  linkColor?: number;
  codeColor?: number;
  codeBackground?: number;
  codeFontFamily?: string;
  quoteBackground?: number;
  ruleColor?: number;
  /** Called when a link is pressed; without it a link is only coloured. */
  onLink?(href: string, title?: string): void;
}

const DEFAULTS = {
  fontSize: 15,
  color: 0xf4f4f5ff,
  linkColor: 0x7cb7ffff,
  codeColor: 0xf0c7a8ff,
  codeBackground: 0xffffff10,
  quoteBackground: 0x7cb7ff12,
  ruleColor: 0xffffff1f,
};

/** The style every span of a block shares. */
interface SpanStyle {
  color: number;
  fontSize: number;
  fontWeight?: number;
  fontStyle?: 'italic';
  fontFamily?: string;
}

interface BlockSpans {
  spans: RichTextSpan[];
  /** The href each span index belongs to, when it is inside a link. */
  links: (string | undefined)[];
  titles: (string | undefined)[];
}

function inlineSpans(
  nodes: readonly Inline[],
  style: SpanStyle,
  props: MarkdownProps,
  out: BlockSpans,
  href?: string,
  title?: string,
): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out.spans.push({ text: node.text, ...style });
        out.links.push(href);
        out.titles.push(title);
        break;
      case 'strong':
        inlineSpans(
          node.children,
          { ...style, fontWeight: 700 },
          props,
          out,
          href,
          title,
        );
        break;
      case 'em':
        inlineSpans(
          node.children,
          { ...style, fontStyle: 'italic' },
          props,
          out,
          href,
          title,
        );
        break;
      case 'del':
        inlineSpans(
          node.children,
          { ...style, color: (style.color & 0xffffff00) | 0x99 },
          props,
          out,
          href,
          title,
        );
        break;
      case 'code':
        out.spans.push({
          text: node.text,
          ...style,
          color: props.codeColor ?? DEFAULTS.codeColor,
          fontFamily: props.codeFontFamily,
        });
        out.links.push(href);
        out.titles.push(title);
        break;
      case 'link':
        inlineSpans(
          node.children,
          { ...style, color: props.linkColor ?? DEFAULTS.linkColor },
          props,
          out,
          node.href,
          node.title,
        );
        break;
      case 'break':
        out.spans.push({ text: '\n', ...style });
        out.links.push(href);
        out.titles.push(title);
        break;
    }
  }
}

function spansOf(
  nodes: readonly Inline[],
  style: SpanStyle,
  props: MarkdownProps,
): BlockSpans {
  const out: BlockSpans = { spans: [], links: [], titles: [] };
  inlineSpans(nodes, style, props, out);
  return out;
}


/**
 * The props a nested block row inherits. Spreading the component's own props
 * would carry `block`/`blocks` down and make a list render itself; only the
 * presentation props cross a nesting boundary.
 */
function optionsOf(props: MarkdownProps): MarkdownProps {
  return {
    source: props.source,
    width: props.width,
    fontSize: props.fontSize,
    color: props.color,
    lineHeight: props.lineHeight,
    linkColor: props.linkColor,
    codeColor: props.codeColor,
    codeBackground: props.codeBackground,
    codeFontFamily: props.codeFontFamily,
    quoteBackground: props.quoteBackground,
    ruleColor: props.ruleColor,
    onLink: props.onLink,
  };
}

/** Lines a code block occupies once wrapped at `width`, at least one. */
function codeLines(text: string, size: number, width: number): number {
  const perChar = size * 0.62;
  const columns = Math.max(8, Math.floor(width / perChar));
  let lines = 0;
  for (const line of text.split('\n')) {
    lines += Math.max(1, Math.ceil(line.length / columns));
  }
  return Math.max(1, lines);
}

/** A run of blocks stacked at `width`, indented inside quotes and lists. */
function Blocks(props: MarkdownProps & { blocks: Block[] }): JSX.Element {
  return (
    <view display="flex" flexDirection="column" gap={10} width={props.width}>
      <For each={props.blocks}>
        {(block) => <BlockView block={block} {...optionsOf(props)} />}
      </For>
    </view>
  );
}

function BlockView(props: MarkdownProps & { block: Block }): JSX.Element {
  const size = () => props.fontSize ?? DEFAULTS.fontSize;
  const base = (): SpanStyle => ({
    color: props.color ?? DEFAULTS.color,
    fontSize: size(),
  });
  const rich = (block: Block, style: SpanStyle): JSX.Element => {
    const spans = spansOf(
      (block as { children: Inline[] }).children,
      style,
      props,
    );
    return (
      <RichText
        width={props.width}
        spans={spans.spans}
        fontSize={style.fontSize}
        color={style.color}
        lineHeight={props.lineHeight}
        onRunPress={
          props.onLink === undefined
            ? undefined
            : (run) => {
                const href = spans.links[run.span];
                if (href !== undefined)
                  props.onLink?.(href, spans.titles[run.span]);
              }
        }
      />
    );
  };

  switch (props.block.type) {
    case 'paragraph':
      return rich(props.block, base());

    case 'heading': {
      const scale =
        props.block.level === 1
          ? 1.5
          : props.block.level === 2
            ? 1.3
            : props.block.level === 3
              ? 1.15
              : 1;
      return rich(props.block, {
        ...base(),
        fontSize: Math.round(size() * scale),
        fontWeight: 700,
      });
    }

    case 'code': {
      const block = props.block;
      const codeSize = () => Math.max(11, size() - 2);
      const lineHeight = () => Math.round(codeSize() * 1.45);
      const height = () =>
        codeLines(block.text, codeSize(), props.width - 24) * lineHeight() + 20;
      return (
        <view
          width={props.width}
          height={height()}
          color={props.codeBackground ?? DEFAULTS.codeBackground}
          borderRadius={8}
          padding={[10, 12]}
        >
          <text
            width={props.width - 24}
            height={height() - 20}
            fontSize={codeSize()}
            color={props.codeColor ?? DEFAULTS.codeColor}
            fontFamily={props.codeFontFamily}
            lineHeight={lineHeight()}
            contain="width"
          >
            {block.text}
          </text>
        </view>
      );
    }

    case 'quote':
      // The scene has no single-side border, so a quote is an indented,
      // tinted block rather than a left rule.
      return (
        <view
          width={props.width}
          color={props.quoteBackground ?? DEFAULTS.quoteBackground}
          borderRadius={6}
          padding={[8, 10]}
          display="flex"
          flexDirection="column"
        >
          <Blocks
            {...optionsOf(props)}
            width={props.width - 20}
            blocks={props.block.children}
          />
        </view>
      );

    case 'list': {
      const block = props.block;
      return (
        <view display="flex" flexDirection="column" gap={6} width={props.width}>
          <For each={block.items}>
            {(item, index) => {
              const bullet = () =>
                block.ordered ? `${block.start + index()}.` : '•';
              return (
                <view
                  display="flex"
                  flexDirection="row"
                  gap={8}
                  width={props.width}
                >
                  <text
                    width={22}
                    height={size() * 1.35}
                    textAlign="right"
                    fontSize={size()}
                    color={props.color ?? DEFAULTS.color}
                  >
                    {bullet()}
                  </text>
                  <view
                    width={props.width - 30}
                    display="flex"
                    flexDirection="column"
                  >
                    <Blocks
                      {...optionsOf(props)}
                      width={props.width - 30}
                      blocks={item.children}
                    />
                  </view>
                </view>
              );
            }}
          </For>
        </view>
      );
    }

    case 'hr':
      return (
        <view
          width={props.width}
          height={1}
          color={props.ruleColor ?? DEFAULTS.ruleColor}
        />
      );
  }
}

export function Markdown(props: MarkdownProps): JSX.Element {
  return (
    <view
      x={props.x}
      y={props.y}
      width={props.width}
      display="flex"
      flexDirection="column"
      gap={10}
    >
      <Blocks {...optionsOf(props)} blocks={markdown(props.source).blocks} />
    </view>
  );
}
