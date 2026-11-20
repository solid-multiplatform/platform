/**
 * A chat message as agent UIs render one: a header, Markdown, and typed
 * parts — a tool call card, a file reference, a fenced code block. The message
 * is a flex column of parts; each part measures itself, so the message's
 * height is its content's.
 *
 * This is presentation only. Virtualising a transcript, measuring message
 * heights and deciding when to expand a tool call stay with the app (the
 * mobile demo does all three).
 */
import { For, Show, type JSX } from 'solid-js';
import { useTheme } from '../sdk/theme.jsx';
import { Markdown, type MarkdownProps } from './Markdown.jsx';

export type ToolStatus = 'running' | 'done' | 'error';

export type MessagePart =
  | { type: 'markdown'; text: string }
  | { type: 'code'; text: string; language?: string }
  | { type: 'file'; path: string; line?: number }
  | {
      type: 'tool';
      name: string;
      status?: ToolStatus;
      /** One line under the name: what the call is doing. */
      title?: string;
      /** The call's arguments, shown when expanded. */
      input?: string;
      /** The call's result, shown when expanded. */
      output?: string;
      durationMs?: number;
      expanded?: boolean;
    };

export interface ChatMessageProps {
  role: 'user' | 'assistant' | 'system';
  /** Shown above the body for assistant and system messages. */
  author?: string;
  /** Already formatted; the app owns date and locale rules. */
  time?: string;
  parts: readonly MessagePart[];
  width: number;
  x?: number;
  y?: number;
  fontSize?: number;
  lineHeight?: number;
  /* Colours; the theme's when omitted. */
  color?: number;
  mutedColor?: number;
  bubbleColor?: number;
  bubbleTextColor?: number;
  cardColor?: number;
  borderColor?: number;
  onLink?(href: string, title?: string): void;
  /** A tool card was pressed; the app flips `expanded` for that part. */
  onToolPress?(index: number): void;
  /** Shared with Markdown: the app's code face, if it registered one. */
  codeFontFamily?: string;
  /** Shared with Markdown: the app's bold face, if it registered one. */
  strongFontFamily?: string;
  /** Shared with Markdown: the link colour; the theme's primary when omitted. */
  linkColor?: number;
}

/** A code block's source, as Markdown sees it. */
function fenced(text: string, language?: string): string {
  const fence = text.includes('```') ? '~~~' : '```';
  return `${fence}${language ?? ''}\n${text}\n${fence}`;
}

export function ChatMessage(props: ChatMessageProps): JSX.Element {
  const theme = () => useTheme();
  const text = () => props.color ?? theme().colors.text;
  const muted = () => props.mutedColor ?? theme().colors.textMuted;
  const border = () => props.borderColor ?? theme().colors.border;
  const mine = () => props.role === 'user';
  const bodyColor = () =>
    mine() ? (props.bubbleTextColor ?? theme().colors.onPrimary) : text();
  const bodyWidth = () => props.width - (mine() ? 24 : 0);

  const statusColor = (status: ToolStatus | undefined): number =>
    status === 'error'
      ? theme().colors.danger
      : status === 'running'
        ? theme().colors.warning
        : theme().colors.success;

  const markdownProps = (): Omit<MarkdownProps, 'source'> => ({
    width: bodyWidth(),
    fontSize: props.fontSize,
    lineHeight: props.lineHeight,
    color: bodyColor(),
    onLink: props.onLink,
    codeFontFamily: props.codeFontFamily,
    strongFontFamily: props.strongFontFamily,
    linkColor: mine() ? props.bubbleTextColor : props.linkColor,
    codeBackground: mine() ? 0x00000026 : undefined,
  });

  return (
    <view
      x={props.x}
      y={props.y}
      width={props.width}
      display="flex"
      flexDirection="column"
      gap={8}
    >
      <Show
        when={
          !mine() && (props.author !== undefined || props.time !== undefined)
        }
      >
        <view display="flex" flexDirection="row" gap={8} alignItems="center">
          <Show when={props.author !== undefined}>
            <text fontSize={13} fontWeight={700} color={text()}>
              {props.author}
            </text>
          </Show>
          <Show when={props.time !== undefined}>
            <text fontSize={12} color={muted()}>
              {props.time}
            </text>
          </Show>
        </view>
      </Show>

      <view
        width={props.width}
        display="flex"
        flexDirection="column"
        gap={8}
        color={
          mine() ? (props.bubbleColor ?? theme().colors.primary) : 0x00000000
        }
        borderRadius={mine() ? 16 : 0}
        padding={mine() ? [10, 12] : 0}
      >
        <For each={props.parts}>
          {(part, index) => {
            switch (part.type) {
              case 'markdown':
                return <Markdown source={part.text} {...markdownProps()} />;

              case 'code':
                return (
                  <Markdown
                    source={fenced(part.text, part.language)}
                    {...markdownProps()}
                  />
                );

              case 'file':
                return (
                  <view
                    display="flex"
                    flexDirection="row"
                    gap={8}
                    alignItems="center"
                    width={bodyWidth()}
                    color={
                      mine()
                        ? 0xffffff1f
                        : (props.cardColor ?? theme().colors.surface)
                    }
                    borderRadius={7}
                    padding={[6, 10]}
                  >
                    <view
                      width={3}
                      height={14}
                      borderRadius={2}
                      color={theme().colors.primary}
                    />
                    <text
                      fontSize={(props.fontSize ?? theme().typography.body) - 3}
                      color={mine() ? bodyColor() : muted()}
                      fontFamily={props.codeFontFamily}
                    >
                      {part.line === undefined
                        ? part.path
                        : `${part.path}:${part.line}`}
                    </text>
                  </view>
                );

              case 'tool': {
                const expanded = part.expanded === true;
                const detail = expanded
                  ? (part.output ?? part.input)
                  : undefined;
                return (
                  <view
                    width={bodyWidth()}
                    display="flex"
                    flexDirection="column"
                    gap={6}
                    color={
                      mine()
                        ? 0xffffff1f
                        : (props.cardColor ?? theme().colors.surface)
                    }
                    border={{ width: 1, color: mine() ? 0xffffff26 : border() }}
                    borderRadius={10}
                    padding={[9, 11]}
                    onMouseClick={
                      props.onToolPress === undefined
                        ? undefined
                        : () => props.onToolPress?.(index())
                    }
                  >
                    <view
                      display="flex"
                      flexDirection="row"
                      gap={8}
                      alignItems="center"
                    >
                      <view
                        width={7}
                        height={7}
                        borderRadius={4}
                        color={statusColor(part.status)}
                      />
                      <text
                        fontSize={
                          (props.fontSize ?? theme().typography.body) - 2
                        }
                        fontWeight={700}
                        color={mine() ? bodyColor() : text()}
                      >
                        {part.name}
                      </text>
                      <Show when={part.durationMs !== undefined}>
                        <text fontSize={11} color={muted()}>
                          {`${Math.round(part.durationMs!)} ms`}
                        </text>
                      </Show>
                      <Show when={part.status === 'running'}>
                        <text fontSize={11} color={muted()}>
                          running
                        </text>
                      </Show>
                    </view>
                    <Show when={part.title !== undefined && !expanded}>
                      <text fontSize={12} color={muted()}>
                        {part.title}
                      </text>
                    </Show>
                    <Show when={detail !== undefined}>
                      <Markdown
                        source={fenced(
                          detail!,
                          expanded && part.output ? 'text' : undefined,
                        )}
                        {...markdownProps()}
                        fontSize={Math.max(11, (props.fontSize ?? 15) - 3)}
                      />
                    </Show>
                  </view>
                );
              }
            }
          }}
        </For>
      </view>
    </view>
  );
}
