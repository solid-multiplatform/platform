import type { Rect } from './input.js';

export interface EditorOptions {
  label: string;
  value?: string;
  purpose?:
    | 'text'
    | 'username'
    | 'current-password'
    | 'new-password'
    | 'email'
    | 'one-time-code'
    | 'number'
    | 'search';
  multiline?: boolean;
  /** End editing when Return submits (single-line fields). */
  blurOnSubmit?: boolean;
  onChange(value: string): void;
  onSubmit?(value: string): void;
  onBlur?(): void;
}
export interface Editor {
  focus(): void;
  blur(): void;
  value(): string;
  setValue(text: string): void;
  setBounds(rect: Rect): void;
  dispose(): void;
}
export interface EditorHost {
  createEditor(options: EditorOptions): Editor;
}

/** Pass a positioned overlay or a form. The browser owns selection, IME and autofill. */
export function browserEditorHost(parent: HTMLElement): EditorHost {
  return {
    createEditor(options) {
      const input = options.multiline
        ? document.createElement('textarea')
        : document.createElement('input');
      const purpose = options.purpose ?? 'text';
      if (input instanceof HTMLTextAreaElement && purpose.includes('password'))
        throw new Error('Password fields must be single line');
      if (input instanceof HTMLInputElement)
        input.type = purpose.includes('password')
          ? 'password'
          : purpose === 'email'
            ? 'email'
            : purpose === 'search'
              ? 'search'
              : purpose === 'number'
                ? 'number'
                : 'text';
      if (purpose === 'number') input.setAttribute('inputmode', 'numeric');
      if (purpose === 'search') input.setAttribute('enterkeyhint', 'search');
      input.name = purpose;
      input.setAttribute('aria-label', options.label);
      input.setAttribute(
        'autocomplete',
        purpose === 'search' || purpose === 'text' ? 'on' : purpose,
      );
      input.value = options.value ?? '';
      input.style.cssText =
        'position:absolute;box-sizing:border-box;margin:0;pointer-events:auto';
      input.addEventListener('input', () => options.onChange(input.value));
      input.addEventListener('blur', () => options.onBlur?.());
      input.addEventListener('keydown', (e) => {
        const key = e as KeyboardEvent;
        key.stopPropagation();
        if (
          key.key === 'Enter' &&
          !key.isComposing &&
          !options.multiline &&
          options.onSubmit
        ) {
          key.preventDefault();
          options.onSubmit(input.value);
          if (options.blurOnSubmit === true) input.blur();
        }
      });
      input.addEventListener('keyup', (e) => e.stopPropagation());
      parent.appendChild(input);
      return {
        focus: () => input.focus(),
        blur: () => input.blur(),
        value: () => input.value,
        setValue(text) {
          if (input.value !== text) input.value = text;
        },
        setBounds({ x, y, width, height }) {
          Object.assign(input.style, {
            left: x + 'px',
            top: y + 'px',
            width: width + 'px',
            height: height + 'px',
          });
        },
        dispose() {
          input.remove();
          input.value = '';
        },
      };
    },
  };
}
