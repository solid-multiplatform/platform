# Markdown and agent chat

`Markdown` renders a message's text as scene nodes; `ChatMessage` renders a
whole message as agent UIs do — Markdown, code, file references and
collapsible tool-call cards. The parser ships separately, so an app that never
shows Markdown does not carry it.

```tsx
import { ChatMessage } from '@solid-multiplatform/platform/primitives';

<ChatMessage
  role="assistant"
  author="Claude"
  time="10:24"
  width={340}
  parts={[
    { type: 'markdown', text: 'Fixed **two** tests.' },
    {
      type: 'tool',
      name: 'Bash',
      status: 'done',
      title: 'npm test',
      output: '1291 passed',
      durationMs: 4120,
      expanded: false,
    },
    { type: 'file', path: 'src/screens/Chat.tsx', line: 120 },
  ]}
  onToolPress={(index) => toggle(index)}
/>;
```

| Part       | Renders                                                                         |
| ---------- | ------------------------------------------------------------------------------- |
| `markdown` | The block and inline subset below.                                              |
| `code`     | A fenced code block with an optional language label.                            |
| `file`     | A chip with the path, and `:line` when given.                                   |
| `tool`     | A card: status dot, name, duration, one-line title; input/output when expanded. |

A tool part is expanded by the app: pass `expanded` and flip it from
`onToolPress`, so the message tree stays a pure function of its props.

## The parser

`@solid-multiplatform/platform/markdown` exports `markdown(source)` (parsed
documents, cached), `parseMarkdown(source)` (always parses), `parseInline`,
`inlineText` and the AST types.

Supported blocks: paragraphs, ATX headings, fenced code, ordered and unordered
lists (nested by indentation), block quotes and thematic breaks. Supported
inline: strong, emphasis, strikethrough, code spans, links and hard line
breaks. Deliberately absent: raw HTML, images, tables, footnotes, maths and
syntax highlighting — a parser that does not implement what the scene cannot
render stays small and cannot disagree with the renderer.

`markdown()` keeps 512 documents and evicts the least recently used; a cached
source is returned by identity. A streaming message has a new source string on
each chunk, so it re-parses only itself — cache hits never parse. The numbers
recorded in `bench/markdown.mjs` on this machine (Node 26, x64):

| Case                              | This parser | `marked` (same corpus) |
| --------------------------------- | ----------- | ---------------------- |
| ordinary chat message, miss       | 7.4 µs      | 26.1 µs                |
| long message (lists + code), miss | 12.5 µs     | 33.7 µs                |
| cache hit                         | 0.13 µs     | —                      |

A phone is several times slower; even so a parse is a fraction of one 8.33 ms
frame at 120 Hz, and a scroll over cached messages parses nothing.

## Rendering limits

- Inline styles map onto what the scene has: strong is weight 700, emphasis is
  `fontStyle: italic` (register an italic face, or the normal one is used),
  inline code is a colour plus the optional `codeFontFamily`, links are a
  colour and `onLink`, strikethrough is muted — there is no strike line.
- Code blocks wrap at the width and clip to the box; there is no horizontal
  code scrolling yet.
- A link press is hit-tested against the laid-out runs, so a paragraph with
  many styles still has one pointer target, not one per run.
- The Markdown and ChatMessage primitives are presentation only. Virtualising
  a transcript, measuring message heights and anchoring the scroll stay with
  the app (the mobile demo implements them; see `handoff/chat-design.md`).
