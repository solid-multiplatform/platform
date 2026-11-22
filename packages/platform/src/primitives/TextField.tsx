import {
  createEffect,
  createSignal,
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

export interface TextFieldProps {
  /** Drawn above the field and given to assistive technology. */
  label: string;
  /** Shown muted while the value is empty. */
  placeholder?: string;
  /** The current value; leave it out to let the field keep its own. */
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  /** Draw bullets and ask the host for a password editor. */
  password?: boolean;
  /** Ask the host for a numeric keyboard (one-time code layout). */
  numeric?: boolean;
  multiline?: boolean;
  /** End editing when Return submits a single-line field. */
  blurOnSubmit?: boolean;
  autofocus?: boolean;
  disabled?: boolean;
  width?: number;
  /**
   * The field box's height. The label's line and gap sit above it, so the
   * control's total height is `height + labelLine + gap` (never a field
   * smaller than a 44-pt touch target). When omitted, one line of text gets
   * a 44-pt box and a multiline field gets three lines.
   */
  height?: number;
  /** The host keyboard hint; derived from `password`/`numeric` when omitted. */
  purpose?: EditorOptions['purpose'];
}

/** The editor options a field asks the host for. */
function purposeOf(props: TextFieldProps): EditorOptions['purpose'] {
  if (props.purpose) return props.purpose;
  if (props.password) return 'new-password';
  if (props.numeric) return 'number';
  return 'text';
}

/**
 * A labelled text field drawn in the scene. The label is a caption above the
 * box, as Apple's forms and `UITextField` guidance place it: it never
 * disappears while editing, so a focused empty field still says what it is.
 * Focus it and press Enter (or click it) to type: the host's editor takes
 * over with its own keyboard, IME and autofill, and every change calls
 * `onChange`. The host draws the placeholder while the value is empty, so
 * the field is never a blank rectangle.
 *
 * The box keeps a 44-pt minimum height at the theme's text size, and the
 * label adds its own line above instead of stealing room from the target.
 * No `Controls` wrapper and no bounds are needed — the field gets the host
 * editor from the app context. Without an editor it still draws label,
 * placeholder and value.
 */
export function TextField(props: TextFieldProps): JSX.Element {
  const theme = useTheme();
  const host: EditorHost | undefined = useContext(AppScope)?.text;
  const [inner, setInner] = createSignal(props.value ?? '');
  // The host editor draws over this field. While it is open the scene's own
  // value is hidden, or the control reads twice; the label stays, because a
  // caption is what tells people which field the keyboard belongs to.
  const [editing, setEditing] = createSignal(false);
  let outer: ElementNode | undefined;
  let box: ElementNode | undefined;
  let editor: Editor | undefined;

  const value = () => props.value ?? inner();
  const masked = (text: string) =>
    // ASCII only: the shipped atlases have no bullet glyph to mask with.
    props.password ? '*'.repeat([...text].length) : text;
  const shown = () => {
    const text = value();
    return text === '' ? (props.placeholder ?? '') : masked(text);
  };

  const hasLabel = () => props.label.trim() !== '';
  const labelSize = () => theme.typography.label;
  const labelLine = () => Math.round(labelSize() * 1.3);
  const labelGap = () => theme.spacing(1);
  const lineHeight = () => Math.round(theme.typography.body * 1.35);
  const boxPaddingX = () => theme.spacing(3);
  const minBoxHeight = () => Math.max(44, lineHeight() + 2 * theme.spacing(2));
  const boxHeight = () => {
    const natural = props.multiline
      ? Math.max(minBoxHeight(), lineHeight() * 3 + 2 * theme.spacing(2))
      : minBoxHeight();
    const requested = props.height;
    if (requested === undefined) return natural;
    const room = requested - (hasLabel() ? labelLine() + labelGap() : 0);
    return Math.max(minBoxHeight(), Math.round(room));
  };
  const controlHeight = () =>
    (hasLabel() ? labelLine() + labelGap() : 0) + boxHeight();
  const verticalPadding = () => (props.multiline ? theme.spacing(2) : 0);
  const lineCount = () =>
    Math.max(
      1,
      Math.floor(
        (boxHeight() - 2 * verticalPadding()) / Math.max(1, lineHeight()),
      ),
    );
  const valueY = () =>
    props.multiline
      ? verticalPadding()
      : Math.max(0, (boxHeight() - lineHeight()) / 2);
  const boxY = () => (hasLabel() ? labelLine() + labelGap() : 0);

  // The editor stands where the field's text would be: the box inset by the
  // same horizontal padding the scene text has.
  const bounds = () => {
    const rect = box
      ? screenRect(box)
      : outer
        ? screenRect(outer)
        : { x: 0, y: 0, width: 0, height: 0 };
    const inset = boxPaddingX();
    const vertical = props.multiline ? theme.spacing(2) : 0;
    const width = rect.width || props.width || 0;
    return {
      x: rect.x + inset,
      y: rect.y + vertical,
      width: Math.max(1, width - 2 * inset),
      height: Math.max(1, (rect.height || boxHeight()) - 2 * vertical),
    };
  };

  /**
   * Keep the field above the keyboard. The nearest touch-scrolling ancestor
   * (a form Column) knows how to move its content; the editor then re-reads
   * the box after the layout pass that scroll triggered.
   */
  const revealInScroller = () => {
    const target = box ?? outer;
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
      // microtask, so read the box one microtask after that.
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

  const open = () => {
    if (props.disabled || host === undefined) return;
    if (editor === undefined) {
      editor = host.createEditor({
        label: props.label,
        value: value(),
        placeholder: props.placeholder,
        placeholderColor: theme.colors.textMuted,
        purpose: purposeOf(props),
        multiline: props.multiline,
        blurOnSubmit: props.blurOnSubmit,
        fontSize: theme.typography.body,
        color: theme.colors.text,
        onChange(next) {
          setInner(next);
          props.onChange?.(next);
        },
        onSubmit: props.onSubmit,
        onBlur: () => setEditing(false),
      });
    }
    editor.setBounds(bounds());
    setEditing(true);
    editor.focus();
    revealInScroller();
  };

  createEffect(() => {
    if (props.value !== undefined) setInner(props.value);
    if (editor !== undefined) editor.setValue(value());
  });
  // The keyboard can open after the field is focused (or close and reopen):
  // reveal the field again whenever the IME inset changes while editing.
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
      ref={(el) => (outer = el)}
      width={props.width}
      height={controlHeight()}
      flexBoundary="fixed"
      autofocus={props.autofocus}
      skipFocus={props.disabled}
      ariaDisabled={props.disabled}
      role="textbox"
      ariaLabel={props.label}
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
      // field it covers, so its box is re-read after every layout pass.
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
          color={
            props.disabled ? theme.colors.textMuted : theme.colors.textMuted
          }
        >
          {props.label}
        </text>
      ) : null}
      <view
        ref={(el) => (box = el)}
        x={0}
        y={boxY()}
        width={props.width}
        height={boxHeight()}
        flexBoundary="fixed"
        borderRadius={theme.radius.medium}
        style={{
          color: theme.colors.surface,
          border: { width: 1, color: theme.colors.border, align: 'inside' },
          $focus: {
            border: { width: 2, color: theme.colors.focus, align: 'inside' },
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
          width={
            props.width === undefined
              ? undefined
              : props.width - 2 * boxPaddingX()
          }
          contain="width"
          maxLines={props.multiline ? lineCount() : 1}
          fontSize={theme.typography.body}
          color={value() === '' ? theme.colors.textMuted : theme.colors.text}
          alpha={editing() ? 0 : 1}
        >
          {shown()}
        </text>
      </view>
    </view>
  );
}

export interface SearchFieldProps extends Omit<TextFieldProps, 'password'> {
  /** Defaults to the label. */
  placeholder?: string;
}

/** A text field that asks the host for its search keyboard. */
export function SearchField(props: SearchFieldProps): JSX.Element {
  return (
    <TextField
      {...props}
      placeholder={props.placeholder ?? props.label}
      purpose="search"
    />
  );
}
