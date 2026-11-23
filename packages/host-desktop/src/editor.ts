// Text entry: the platform's `EditorHost` over the runtime's text input.
//
// The system owns the keyboard layout and the input method (composition and
// its candidate window, placed beside the caret); this file owns the text,
// the caret and the selection; `field.tsx` draws them in the scene. A field
// that has the keyboard hears every key before the focus manager does, as an
// `<input>` does in a page.
//
// Offsets are UTF-16, as in a JavaScript string; the caret and deletion move
// by user-perceived characters. Not implemented: undo, moving by word, and
// double-click selection.
import type {
  Editor,
  EditorHost,
  EditorOptions,
} from '@solid-multiplatform/platform/editor';
import type { Point, Rect } from '@solid-multiplatform/platform/input';
import { onNative } from './events.js';
import { mountField, type FieldStyle } from './field.jsx';
import type { DesktopKeyboardEvent } from './keys.js';

/** What a field shows; offsets are into `display`. */
export interface FieldState {
  /** The text with the composition in place; dots for a password. */
  display: string;
  caret: number;
  selectionStart: number;
  selectionEnd: number;
  /** The text an input method is composing; empty (equal offsets) when none. */
  compositionStart: number;
  compositionEnd: number;
  focused: boolean;
}

/** The editor `createEditor` returns, with what the field's view needs. */
export interface DesktopEditor extends Editor {
  /** Select from `start` to `end` (the caret), in offsets of the text. */
  select(start: number, end?: number): void;
  /** Whether this editor has the keyboard. */
  focused(): boolean;
}

export interface DesktopEditorHost extends EditorHost {
  createEditor(options: EditorOptions): DesktopEditor;
  /** A key for the focused field, if any: true when the field took it. */
  handleKey(event: DesktopKeyboardEvent): boolean;
  dispose(): void;
}

const DOT = '•';

/** Where each user-perceived character of `text` starts, then its length. */
const boundaries = (text: string): number[] => __solid.text!.graphemes(text);

interface Field extends DesktopEditor {
  key(event: DesktopKeyboardEvent): boolean;
  inserted(text: string): void;
  composing(text: string, start: number): void;
  contains(x: number, y: number): boolean;
}

/**
 * The editor host of a window. A field's own scene node takes the pointer
 * (`field.tsx`): a click focuses it and places its caret. `primary` is the
 * modifier of the clipboard shortcuts.
 */
export function desktopEditors(
  primary: 'ctrl' | 'meta',
  style: FieldStyle = {},
): DesktopEditorHost {
  const text = __solid.text;
  const clipboard = __solid.clipboard;
  if (text === undefined || clipboard === undefined) {
    throw new Error('The desktop host needs a window: run without --headless');
  }
  let active: Field | undefined;
  const fields = new Set<Field>();

  function createEditor(options: EditorOptions): DesktopEditor {
    const purpose = options.purpose ?? 'text';
    const secret = purpose.endsWith('password');
    const multiline = options.multiline === true;
    if (secret && multiline) {
      throw new Error('Password fields must be single line');
    }
    let value = options.value ?? '';
    /** The value when the keyboard last entered this field (Escape reverts). */
    let beforeEdit = value;
    let anchor = value.length;
    let caret = value.length;
    let preedit = '';
    // The caret inside the composition, as the input method places it.
    let preeditCaret = 0;
    let rect: Rect = { x: 0, y: 0, width: 1, height: 1 };
    let caretX = 0;
    let closed = false;
    /** Whether this field has the keyboard. */
    let keyboard = false;

    const mask = (part: string): string =>
      secret ? DOT.repeat(boundaries(part).length - 1) : part;

    function state(): FieldState {
      const lo = Math.min(anchor, caret);
      const hi = Math.max(anchor, caret);
      const before = mask(value.slice(0, lo));
      if (preedit !== '') {
        // The composition stands where the selection was until it commits.
        const composed = mask(preedit);
        const at = before.length + mask(preedit.slice(0, preeditCaret)).length;
        return {
          display: before + composed + mask(value.slice(hi)),
          caret: at,
          selectionStart: at,
          selectionEnd: at,
          compositionStart: before.length,
          compositionEnd: before.length + composed.length,
          focused: keyboard,
        };
      }
      const selected = mask(value.slice(lo, hi));
      const caretAt =
        caret === lo ? before.length : before.length + selected.length;
      return {
        display: before + selected + mask(value.slice(hi)),
        caret: caretAt,
        selectionStart: before.length,
        selectionEnd: before.length + selected.length,
        compositionStart: caretAt,
        compositionEnd: caretAt,
        focused: keyboard,
      };
    }

    const view = mountField({
      state: state(),
      multiline,
      // The hint the scene drew while the field was unfocused, in its colour:
      // a focused empty field still says what it is.
      placeholder: options.placeholder,
      placeholderColor: options.placeholderColor,
      // The rect the scene sent is where its text already sits (inset by the
      // field's own padding), so the view draws at the rect's origin with the
      // scene's type size and colour: focusing hands over with no reflow.
      style: {
        ...style,
        fontSize: options.fontSize ?? style.fontSize,
        color: options.color ?? style.color,
      },
      /** An offset into what is shown as an offset into the text. */
      toText(offset: number): number {
        if (!secret) return offset;
        const stops = boundaries(value);
        return stops[Math.min(offset, stops.length - 1)]!;
      },
      /** The view measured the caret: the input method follows it. */
      caretMoved(x: number): void {
        caretX = x;
        if (keyboard) place();
      },
      /** A click gives the field the keyboard and places its caret. */
      click(point: Point): void {
        field.focus();
        if (preedit === '') field.select(view.offsetAt(point, rect));
      },
      /** A drag selects from where it began to where it is. */
      drag(point: Point, origin: Point): void {
        if (preedit !== '') return;
        field.focus();
        field.select(view.offsetAt(origin, rect), view.offsetAt(point, rect));
      },
    });
    const notify = (): void => view.update(state());
    const place = (): void =>
      text!.area(rect.x, rect.y, rect.width, rect.height, caretX);

    function replace(inserted: string): void {
      const lo = Math.min(anchor, caret);
      const hi = Math.max(anchor, caret);
      const insert = multiline ? inserted : inserted.replace(/[\r\n]+/g, '');
      const next = value.slice(0, lo) + insert + value.slice(hi);
      const changed = next !== value;
      value = next;
      anchor = caret = lo + insert.length;
      preedit = '';
      notify();
      if (changed) options.onChange(value);
    }

    /** The boundary next to the caret in `direction`. */
    function neighbour(direction: -1 | 1): number {
      const stops = boundaries(value);
      if (direction < 0) {
        let previous = 0;
        for (const stop of stops) {
          if (stop >= caret) break;
          previous = stop;
        }
        return previous;
      }
      for (const stop of stops) if (stop > caret) return stop;
      return value.length;
    }

    /** The boundary at or before `offset`. */
    function snap(offset: number): number {
      let at = 0;
      for (const stop of boundaries(value)) {
        if (stop > offset) break;
        at = stop;
      }
      return at;
    }

    /** The caret one line up or down, in the same column where there is one. */
    function vertical(direction: -1 | 1): number {
      const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
      const column = caret - lineStart;
      if (direction < 0) {
        if (lineStart === 0) return 0;
        const previousStart = value.lastIndexOf('\n', lineStart - 2) + 1;
        return snap(Math.min(previousStart + column, lineStart - 1));
      }
      const lineEnd = value.indexOf('\n', caret);
      if (lineEnd === -1) return value.length;
      const nextEnd = value.indexOf('\n', lineEnd + 1);
      return snap(
        Math.min(lineEnd + 1 + column, nextEnd === -1 ? value.length : nextEnd),
      );
    }

    function move(to: number, extend: boolean): void {
      caret = to;
      if (!extend) anchor = to;
      notify();
    }

    const field: Field = {
      value: () => value,
      setValue(next) {
        if (next === value) return;
        value = next;
        anchor = caret = Math.min(caret, value.length);
        preedit = '';
        notify();
      },
      setBounds(next) {
        rect = next;
        view.place(next);
        if (active === field) place();
      },
      focused: () => keyboard,
      focus() {
        if (closed || active === field) return;
        active?.blur();
        active = field;
        beforeEdit = value;
        keyboard = true;
        place();
        text!.start(purpose, multiline);
        notify();
      },
      blur() {
        if (active !== field) return;
        text!.stop();
        active = undefined;
        keyboard = false;
        preedit = '';
        notify();
        options.onBlur?.();
      },
      select(start, end = start) {
        anchor = snap(Math.max(0, Math.min(start, value.length)));
        caret = snap(Math.max(0, Math.min(end, value.length)));
        notify();
      },
      contains: (x, y) =>
        x >= rect.x &&
        y >= rect.y &&
        x < rect.x + rect.width &&
        y < rect.y + rect.height,
      inserted: replace,
      composing(composed, start) {
        preedit = composed;
        // The input method counts characters, a string UTF-16 units.
        const marked = Array.from(composed).slice(0, Math.max(0, start));
        preeditCaret = start < 0 ? composed.length : marked.join('').length;
        notify();
      },
      key(event) {
        if (event.key === 'Tab') {
          // Tab leaves the field and goes on to whoever moves focus.
          if (event.type === 'keydown') field.blur();
          return false;
        }
        const editing =
          event.key.length === 1 ||
          event.key === 'Enter' ||
          event.key === 'Backspace' ||
          event.key === 'Delete' ||
          event.key === 'Escape' ||
          event.key === 'Home' ||
          event.key === 'End' ||
          event.key.startsWith('Arrow');
        // Function and media keys are not the field's.
        if (!editing) return false;
        if (event.type !== 'keydown') return true;
        if (event.key === 'Escape') {
          // Escape cancels the edit and restores the value the field had
          // when it took the keyboard, as AppKit does.
          if (value !== beforeEdit) {
            value = beforeEdit;
            anchor = caret = value.length;
            preedit = '';
            notify();
            options.onChange?.(value);
          }
          field.blur();
          return true;
        }
        // While composing, keys are the input method's.
        if (preedit !== '') return true;
        if (primary === 'meta' ? event.metaKey : event.ctrlKey) {
          const lo = Math.min(anchor, caret);
          const hi = Math.max(anchor, caret);
          switch (event.key.toLowerCase()) {
            case 'a':
              anchor = 0;
              move(value.length, true);
              break;
            case 'c':
            case 'x':
              // A password does not leave its field.
              if (!secret && lo !== hi) {
                clipboard!.write(value.slice(lo, hi));
                if (event.key.toLowerCase() === 'x') replace('');
              }
              break;
            case 'v':
              replace(clipboard!.read());
              break;
            default:
              // Cmd+S/Z/F and the rest belong to the app, not the field.
              return false;
          }
          return true;
        }
        switch (event.key) {
          case 'Enter':
            if (multiline) replace('\n');
            else {
              options.onSubmit?.(value);
              // Return ends editing when the field asks for it, as the phone
              // and web editors do.
              if (options.blurOnSubmit === true) field.blur();
            }
            break;
          case 'Backspace':
          case 'Delete':
            if (anchor === caret) {
              anchor = neighbour(event.key === 'Backspace' ? -1 : 1);
            }
            replace('');
            break;
          case 'ArrowLeft':
          case 'ArrowRight': {
            const direction = event.key === 'ArrowLeft' ? -1 : 1;
            // Without Shift a selection collapses to the end moved towards.
            const collapse = anchor !== caret && !event.shiftKey;
            const to = !collapse
              ? neighbour(direction)
              : direction < 0
                ? Math.min(anchor, caret)
                : Math.max(anchor, caret);
            move(to, event.shiftKey);
            break;
          }
          case 'ArrowUp':
          case 'ArrowDown':
            if (multiline) {
              move(vertical(event.key === 'ArrowUp' ? -1 : 1), event.shiftKey);
            }
            break;
          case 'Home':
            move(
              multiline ? value.lastIndexOf('\n', caret - 1) + 1 : 0,
              event.shiftKey,
            );
            break;
          case 'End': {
            const end = multiline ? value.indexOf('\n', caret) : -1;
            move(end === -1 ? value.length : end, event.shiftKey);
            break;
          }
        }
        return true;
      },
      dispose() {
        if (closed) return;
        field.blur();
        closed = true;
        fields.delete(field);
        view.dispose();
        // A password does not stay in memory with its field.
        value = '';
        preedit = '';
      },
    };
    fields.add(field);
    return field;
  }

  const stops = [
    onNative('textinput', (e) => active?.inserted(e.text)),
    onNative('textediting', (e) => active?.composing(e.text, e.start)),
    // A press anywhere else takes the keyboard from the field.
    onNative('pointerdown', (e) => {
      if (active !== undefined && !active.contains(e.x, e.y)) active.blur();
    }),
  ];

  return {
    createEditor,
    handleKey: (event) => active?.key(event) ?? false,
    dispose() {
      for (const stop of stops) stop();
      for (const field of [...fields]) field.dispose();
    },
  };
}
