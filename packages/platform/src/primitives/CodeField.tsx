import {
  createEffect,
  createSignal,
  Index,
  onCleanup,
  useContext,
  type JSX,
} from 'solid-js';
import type { ElementNode } from '@solid-multiplatform/platform';
import { AppScope } from '../app/context.js';
import type { Editor, EditorHost, EditorOptions } from '../sdk/editor.js';
import { screenRect } from '../sdk/layout.js';
import { useTheme } from '../sdk/theme.jsx';
import { viewport } from '../sdk/viewport.js';
import { chainRefs } from './utils/chainFunctions.js';

export interface CodeFieldProps {
  /**
   * Drawn above the slots and given to the host editor and assistive
   * technology. Leave it out when the screen's heading already says what the
   * code is for; the editor is then labelled "Code".
   */
  label?: string;
  /** How many slots the code has. Defaults to 6. */
  slots?: number;
  /**
   * The code, or the part of it entered so far. Leave `value` out to let the
   * field keep its own; passing `''` clears the slots.
   */
  value?: string;
  onChange?: (code: string) => void;
  /**
   * Fires once each time the last slot fills — once per completed code, not
   * once per keystroke. It fires again only after the code has stopped being
   * complete (the user cleared a slot, or the app passed a shorter `value`).
   */
  onComplete?: (code: string) => void;
  /**
   * Return (or the field's Enter, which opens the editor) submits. The code
   * is passed only when every slot is filled.
   */
  onSubmit?: (code: string) => void;
  /**
   * Draw an asterisk per entered character. Apple's digit-entry guidance is
   * to hide codes that are secrets, and a one-time code is one.
   */
  secure?: boolean;
  autofocus?: boolean;
  disabled?: boolean;
  /** The host keyboard hint; `one-time-code` when omitted. */
  purpose?: EditorOptions['purpose'];
  /** End editing when Return submits. */
  blurOnSubmit?: boolean;
  /** The row's width; the slots share it. Omitted: 44-pt squares. */
  width?: number;
  /** The row's height; never under a 44-pt target. */
  height?: number;
  ref?: (node: ElementNode) => void;
}

/**
 * Characters that carry a code. Whitespace and the separators senders wrap
 * codes in ("123-456", "123 456") are not code.
 */
const SEPARATORS = /[\s\-.:,;/]+/g;
const codeChars = (text: string): string => text.replace(SEPARATORS, '');

/** The first `slots` code-characters of `text`, by user-perceived character. */
const firstCodeChars = (text: string, slots: number): string => {
  const chars = codeChars(text);
  return chars === '' ? '' : Array.from(chars).slice(0, slots).join('');
};

/**
 * What one edit inserted between two editor values: the middle that is not
 * the shared start or the shared end. An empty result is a deletion.
 */
function insertionOf(before: string, after: string): string {
  if (after === before) return '';
  let start = 0;
  const limit = Math.min(before.length, after.length);
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start))
    start++;
  let end = 0;
  while (
    end < limit - start &&
    before.charCodeAt(before.length - 1 - end) ===
      after.charCodeAt(after.length - 1 - end)
  )
    end++;
  return after.slice(start, after.length - end);
}

/**
 * A row of boxes for a one-time code, drawn in the scene. The field is one
 * focus stop: focus it (or click it) and the host's editor takes over, the
 * same editor `TextField` opens, so the system keyboard, IME and the host's
 * one-time-code autofill all reach it. The platform owns ONE editor, never
 * one native input per box; the boxes are drawn, not typed into.
 *
 * Every change is read the way the slots work:
 * - one character (or a deletion) is typing: the slots are the first
 *   `slots` code-characters of the editor's text, so a character fills the
 *   next empty slot and Backspace clears the last filled one;
 * - two or more code-characters arriving together are a paste, an autofill
 *   or a drop: the inserted characters REPLACE the code from slot 0, first
 *   `slots` of them, because a pasted code is a whole code, not a fragment
 *   to merge into what was already typed. The classic broken
 *   one-character-per-input field is the one that cannot do this.
 *
 * While the editor is open it draws the code over the row (as `TextField`
 * hands its text to the host); the boxes return when focus leaves. The field
 * schedules nothing while idle — no caret blink, no timers — and follows the
 * keyboard the same way `TextField` does, so a `KeyboardAvoidingView` or a
 * scrolling form keeps the editor over its slots.
 */
export function CodeField(props: CodeFieldProps): JSX.Element {
  const theme = useTheme();
  const host: EditorHost | undefined = useContext(AppScope)?.text;
  const slots = () => Math.max(1, Math.round(props.slots ?? 6));
  const clean = (text: string) => firstCodeChars(text, slots());
  const [inner, setInner] = createSignal(clean(props.value ?? ''));
  // The host editor draws over the row. While it is open the scene's own
  // characters are hidden, or the control reads twice; the boxes stay.
  const [editing, setEditing] = createSignal(false);
  const code = () => (props.value !== undefined ? clean(props.value) : inner());
  // What the host editor holds right now. An editor reports whole values
  // only, so this is the base every reported change is read against.
  let raw = code();
  let outer: ElementNode | undefined;
  let row: ElementNode | undefined;
  let editor: Editor | undefined;

  const hasLabel = () => (props.label ?? '').trim() !== '';
  const labelSize = () => theme.typography.label;
  const labelLine = () => Math.round(labelSize() * 1.3);
  const labelGap = () => theme.spacing(1);
  const lineHeight = () => Math.round(theme.typography.body * 1.35);
  const gap = () => theme.spacing(2);
  const defaultSide = () => Math.max(44, lineHeight() + 2 * theme.spacing(2));
  const side = () =>
    props.width === undefined
      ? defaultSide()
      : Math.max(28, (props.width - (slots() - 1) * gap()) / slots());
  const rowHeight = () => Math.max(44, props.height ?? side());
  const rowWidth = () =>
    props.width ?? slots() * defaultSide() + (slots() - 1) * gap();
  const rowY = () => (hasLabel() ? labelLine() + labelGap() : 0);
  const controlHeight = () => rowY() + rowHeight();
  const shown = (char: string) =>
    char === '' ? '' : props.secure ? '*' : char;

  // The editor stands over the whole row of slots, not inside one box.
  const bounds = () => {
    const rect = row
      ? screenRect(row)
      : outer
        ? screenRect(outer)
        : { x: 0, y: 0, width: 0, height: 0 };
    return {
      x: rect.x,
      y: rect.y,
      width: Math.max(1, rect.width || rowWidth()),
      height: Math.max(1, rect.height || rowHeight()),
    };
  };

  /**
   * Keep the slots above the keyboard. The nearest touch-scrolling ancestor
   * (a form Column) knows how to move its content; the editor then re-reads
   * the row after the layout pass that scroll triggered.
   */
  const revealInScroller = () => {
    const target = row ?? outer;
    if (target === undefined) return;
    const reveal = (scroller: ElementNode) => {
      (
        scroller as unknown as {
          revealElement(
            node: ElementNode,
            options?: { duration?: number; bottomInset?: number },
          ): void;
        }
      ).revealElement(target, {
        duration: 0,
        bottomInset: viewport().insets.ime.bottom + theme.spacing(3),
      });
      // The scroll writes the container's position; layout runs in a
      // microtask, so read the row one microtask after that.
      queueMicrotask(() => {
        queueMicrotask(() => {
          if (editing() && editor !== undefined) editor.setBounds(bounds());
        });
      });
    };
    let parent = target.parent;
    let fallback: ElementNode | undefined;
    while (parent !== undefined) {
      const candidate = parent as unknown as {
        revealElement?: unknown;
        scrollAxis?: 'x' | 'y';
      };
      if (typeof candidate.revealElement === 'function') {
        // A field scrolls its page, not a horizontal rail it happens to sit
        // in; prefer the first vertical scroller and keep any scroller only
        // as a fallback.
        if (candidate.scrollAxis === 'y') {
          reveal(parent);
          return;
        }
        fallback ??= parent;
      }
      parent = parent.parent;
    }
    if (fallback !== undefined) reveal(fallback);
  };

  /**
   * One change from the host editor: the whole text it now holds. The editor
   * cannot say whether the change was typed, pasted or autofilled, so the
   * size of the insertion decides how the slots read it (see the component
   * comment). Whatever the code becomes, the editor is asked to hold exactly
   * that, so its own drawing never disagrees with the boxes.
   *
   * One delivery stays genuinely ambiguous through this port: a whole-field
   * replacement (select-all paste, autofill) whose code starts with what the
   * field already held reads the same as appending the new remainder, and the
   * fragment reading wins. Pasting again fixes it, and an autofill onto an
   * empty or differently-starting field — the usual flow — is never
   * ambiguous.
   */
  const commit = (after: string) => {
    if (after === raw) return;
    const inserted = codeChars(insertionOf(raw, after));
    const was = code();
    const next = inserted.length >= 2 ? clean(inserted) : clean(after);
    raw = next;
    if (next !== after) editor?.setValue(next);
    if (next === was) return;
    setInner(next);
    props.onChange?.(next);
    if (next.length === slots() && was.length < slots())
      props.onComplete?.(next);
  };

  /** Return submits the complete code; a partial one stays in the field. */
  const submit = () => {
    const text = code();
    if (text.length === slots()) props.onSubmit?.(text);
  };

  const open = () => {
    if (props.disabled || host === undefined) return;
    if (editor === undefined) {
      raw = code();
      editor = host.createEditor({
        label: props.label ?? 'Code',
        value: code(),
        purpose: props.purpose ?? 'one-time-code',
        blurOnSubmit: props.blurOnSubmit,
        fontSize: theme.typography.body,
        color: theme.colors.text,
        onChange: commit,
        onSubmit: submit,
        onBlur: () => setEditing(false),
      });
    }
    editor.setBounds(bounds());
    setEditing(true);
    editor.focus();
    revealInScroller();
  };

  createEffect(() => {
    if (props.value !== undefined) setInner(clean(props.value));
    const text = code();
    if (editor !== undefined && raw !== text) {
      raw = text;
      editor.setValue(text);
    }
  });
  // The keyboard can open after the field is focused (or close and reopen):
  // reveal the row again whenever the IME inset changes while editing.
  createEffect(() => {
    const ime = viewport().insets.ime.bottom;
    if (!editing() || ime <= 0) return;
    revealInScroller();
  });
  onCleanup(() => {
    editor?.dispose();
    editor = undefined;
  });

  return (
    <view
      ref={chainRefs(props.ref, (el) => (outer = el))}
      width={props.width}
      height={controlHeight()}
      flexBoundary="fixed"
      autofocus={props.autofocus}
      skipFocus={props.disabled}
      ariaDisabled={props.disabled}
      role="textbox"
      ariaLabel={props.label ?? 'Code'}
      cursorStyle={props.disabled ? 'not-allowed' : 'text'}
      forwardStates
      onFocus={open}
      onEnter={open}
      onMouseClick={open}
      // When the scene moves focus (a dialog opens, another field is
      // tapped), the native editor is a view above the scene: it has to be
      // told to leave, or its hint keeps floating over the dialog that just
      // opened.
      onBlur={() => {
        if (!editing()) return;
        setEditing(false);
        editor?.blur();
      }}
      // The keyboard scrolls the form; the host editor has to follow the
      // slots it covers, so its box is re-read after every layout pass.
      onLayout={() => {
        if (editing() && editor !== undefined) editor.setBounds(bounds());
      }}
    >
      {hasLabel() ? (
        <text
          skipFocus
          x={0}
          y={0}
          width={props.width}
          height={labelLine()}
          contain={props.width === undefined ? undefined : 'width'}
          maxLines={1}
          fontSize={labelSize()}
          color={theme.colors.textMuted}
        >
          {props.label}
        </text>
      ) : null}
      <view
        ref={(el) => (row = el)}
        x={0}
        y={rowY()}
        width={rowWidth()}
        height={rowHeight()}
        flexBoundary="fixed"
      >
        <Index each={Array.from({ length: slots() })}>
          {(_, index) => (
            <view
              // The field is one focus stop: the boxes are drawn state, not
              // six more places a remote could land.
              skipFocus
              x={index * (side() + gap())}
              y={0}
              width={side()}
              height={rowHeight()}
              borderRadius={theme.radius.medium}
              style={{
                color: theme.colors.surface,
                border: {
                  width: 1,
                  color: theme.colors.border,
                  align: 'inside',
                },
                $focus: {
                  border: {
                    width: 2,
                    color: theme.colors.focus,
                    align: 'inside',
                  },
                },
                $hover: {
                  border: {
                    width: 1,
                    color: theme.colors.textMuted,
                    align: 'inside',
                  },
                },
              }}
            >
              <text
                skipFocus
                x={0}
                y={Math.max(0, (rowHeight() - lineHeight()) / 2)}
                width={side()}
                // Centering needs contain: without it the backend draws the
                // character from the box's left edge and warns.
                contain="width"
                maxLines={1}
                textAlign="center"
                fontSize={theme.typography.body}
                color={theme.colors.text}
                alpha={editing() ? 0 : 1}
              >
                {shown(code().charAt(index))}
              </text>
            </view>
          )}
        </Index>
      </view>
    </view>
  );
}
