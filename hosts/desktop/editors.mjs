// SDL owns IME composition and candidate positioning. The renderer owns the field's
// appearance. Indices are UTF-16 offsets; left/right and delete move by grapheme.
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const boundaries = (s) => [
  ...Array.from(segmenter.segment(s), (g) => g.index),
  s.length,
];
export function desktopEditors(nativeWindow) {
  let active;
  function createEditor(options) {
    const secret = options.purpose?.endsWith('password');
    let text = options.value ?? '',
      anchor = text.length,
      caret = text.length,
      preedit = '',
      rect = { x: 0, y: 0, width: 1, height: 1 },
      closed = false;
    const mask = (t) =>
      secret ? '•'.repeat([...segmenter.segment(t)].length) : t;
    function notify() {
      const lo = Math.min(anchor, caret),
        hi = Math.max(anchor, caret);
      options.onState?.({
        display:
          mask(text.slice(0, lo)) +
          (preedit ? mask(preedit) : mask(text.slice(lo, hi))) +
          mask(text.slice(hi)),
        selectionStart: mask(text.slice(0, lo)).length,
        selectionEnd: mask(text.slice(0, hi)).length,
        caret: mask(text.slice(0, caret)).length,
        composition: mask(preedit),
        focused: active === field,
      });
    }
    function replace(value) {
      const lo = Math.min(anchor, caret),
        hi = Math.max(anchor, caret);
      const insert = options.multiline ? value : value.replace(/[\r\n]/g, '');
      text = text.slice(0, lo) + insert + text.slice(hi);
      anchor = caret = lo + insert.length;
      preedit = '';
      notify();
      options.onChange(text);
    }
    function neighbor(direction) {
      const stops = boundaries(text);
      return direction < 0
        ? (stops.filter((i) => i < caret).at(-1) ?? 0)
        : (stops.find((i) => i > caret) ?? text.length);
    }
    const field = {
      value: () => text,
      setValue(next) {
        if (next !== text) {
          text = next;
          anchor = caret = Math.min(caret, text.length);
          preedit = '';
          notify();
        }
      },
      setBounds(next) {
        rect = next;
        if (active === field) nativeWindow.imeRect(rect);
      },
      focus() {
        if (closed || active === field) return;
        active?.blur();
        active = field;
        nativeWindow.imeRect(rect);
        nativeWindow.textInput(true);
        notify();
      },
      blur() {
        if (active !== field) return;
        nativeWindow.textInput(false);
        active = undefined;
        preedit = '';
        notify();
        options.onBlur?.();
      },
      select(start, end = start) {
        const stops = boundaries(text);
        const at = (n) => stops.findLast((i) => i <= Math.max(0, n)) ?? 0;
        anchor = at(start);
        caret = at(end);
        notify();
      },
      handle(name, e) {
        if (
          name === 'pointerdown' &&
          (e.clientX < rect.x ||
            e.clientY < rect.y ||
            e.clientX >= rect.x + rect.width ||
            e.clientY >= rect.y + rect.height)
        ) {
          field.blur();
          return false;
        }
        if (name === 'compositionupdate') {
          preedit = e.data;
          notify();
          return true;
        }
        if (name === 'textinput') {
          replace(e.data);
          return true;
        }
        if (name === 'blur') {
          field.blur();
          return false;
        }
        if (name !== 'keydown' && name !== 'keyup') return false;
        if (e.key === 'Tab') {
          if (name === 'keydown') field.blur();
          return false;
        }
        if (name === 'keyup') return true;
        if (e.key === 'Escape') {
          field.blur();
          return true;
        }
        if (preedit) return true;
        const shortcut = e.ctrlKey || e.metaKey;
        if (shortcut) {
          switch (e.key.toLowerCase()) {
            case 'a':
              field.select(0, text.length);
              break;
            case 'c':
            case 'x':
              if (!secret && caret !== anchor) {
                nativeWindow.copy(
                  text.slice(Math.min(anchor, caret), Math.max(anchor, caret)),
                );
                if (e.key.toLowerCase() === 'x') replace('');
              }
              break;
            case 'v':
              replace(nativeWindow.paste());
              break;
          }
          return true;
        }
        if (e.key === 'Enter') {
          if (options.multiline) replace('\n');
          else options.onSubmit?.(text);
          return true;
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          if (anchor === caret)
            anchor = neighbor(e.key === 'Backspace' ? -1 : 1);
          replace('');
          return true;
        }
        const direction =
          e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        if (direction || e.key === 'Home' || e.key === 'End') {
          const next = direction
            ? anchor !== caret && !e.shiftKey
              ? direction < 0
                ? Math.min(anchor, caret)
                : Math.max(anchor, caret)
              : neighbor(direction)
            : e.key === 'Home'
              ? 0
              : text.length;
          caret = next;
          if (!e.shiftKey) anchor = next;
          notify();
        }
        return true;
      },
      dispose() {
        field.blur();
        closed = true;
        text = '';
        preedit = '';
      },
    };
    return field;
  }
  return {
    createEditor,
    handle: (name, e) => active?.handle(name, e) ?? false,
    dispose: () => active?.dispose(),
  };
}
