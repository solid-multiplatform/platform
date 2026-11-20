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
import type { Rect } from '../sdk/input.js';
import { useTheme } from '../sdk/theme.jsx';

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
 * The position and size of a node on screen, following the scale of its
 * ancestors. Host editors that draw over the scene (the web input) place
 * themselves with it.
 */
function screenRect(node: ElementNode): Rect {
  const chain: ElementNode[] = [];
  for (let n: ElementNode | undefined = node; n; n = n.parent) chain.unshift(n);
  let x = 0;
  let y = 0;
  let scale = 1;
  for (const n of chain) {
    x += (n.x || 0) * scale;
    y += (n.y || 0) * scale;
    scale *= n.scale || 1;
  }
  return {
    x,
    y,
    width: node.width * scale,
    height: node.height * scale,
  };
}

/**
 * A labelled text field drawn in the scene. Focus it and press Enter (or
 * click it) to type: the host's editor takes over with its own keyboard,
 * IME and autofill, and every change calls `onChange`. No `Controls` wrapper
 * and no bounds are needed — the field gets the host editor from the app
 * context. Without an editor it still draws label, placeholder and value.
 */
export function TextField(props: TextFieldProps): JSX.Element {
  const theme = useTheme();
  const host: EditorHost | undefined = useContext(AppScope)?.text;
  const [inner, setInner] = createSignal(props.value ?? '');
  // The host editor draws over this field. While it is open the scene's own
  // label and value are hidden, or the control reads twice.
  const [editing, setEditing] = createSignal(false);
  let node: ElementNode | undefined;
  let editor: Editor | undefined;

  const value = () => props.value ?? inner();
  const masked = (text: string) =>
    // ASCII only: the shipped atlases have no bullet glyph to mask with.
    props.password ? '*'.repeat([...text].length) : text;
  const shown = () => {
    const text = value();
    return text === '' ? (props.placeholder ?? '') : masked(text);
  };

  const bounds = () => {
    const rect = node ? screenRect(node) : { x: 0, y: 0, width: 0, height: 0 };
    return {
      ...rect,
      width: rect.width || props.width || 0,
      height:
        rect.height ||
        props.height ||
        Math.round(theme.typography.body * 1.35) + 2 * theme.spacing(2),
    };
  };

  const open = () => {
    if (props.disabled || host === undefined) return;
    if (editor === undefined) {
      editor = host.createEditor({
        label: props.label,
        value: value(),
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
  };

  createEffect(() => {
    if (props.value !== undefined) setInner(props.value);
    if (editor !== undefined) editor.setValue(value());
  });
  onCleanup(() => {
    editor?.dispose();
    editor = undefined;
  });

  return (
    <view
      ref={(el) => (node = el)}
      display="flex"
      flexDirection="column"
      alignItems="flexStart"
      justifyContent="center"
      gap={2}
      width={props.width}
      height={props.height}
      padding={[6, theme.spacing(3)]}
      borderRadius={theme.radius.medium}
      autofocus={props.autofocus}
      skipFocus={props.disabled}
      ariaDisabled={props.disabled}
      role="textbox"
      ariaLabel={props.label}
      cursorStyle={props.disabled ? 'not-allowed' : 'text'}
      forwardStates
      style={{
        color: theme.colors.surface,
        border: { width: 1, color: theme.colors.border, align: 'inside' },
        $focus: {
          border: { width: 2, color: theme.colors.focus, align: 'inside' },
        },
        $hover: {
          border: { width: 1, color: theme.colors.textMuted, align: 'inside' },
        },
      }}
      onFocus={open}
      onEnter={open}
      onMouseClick={open}
      // The keyboard scrolls the form; the host editor has to follow the
      // field it covers, so its box is re-read after every layout pass.
      onLayout={() => {
        if (editing() && editor !== undefined) editor.setBounds(bounds());
      }}
    >
      <text
        fontSize={theme.typography.label}
        color={theme.colors.textMuted}
        hidden={editing()}
      >
        {props.label}
      </text>
      <text
        fontSize={theme.typography.body}
        color={value() === '' ? theme.colors.textMuted : theme.colors.text}
        hidden={editing()}
      >
        {shown()}
      </text>
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
