import { Config } from '../core/config.js';
import type { Rect } from './input.js';

export interface EditorOptions {
  label: string;
  value?: string;
  /** Drawn by the host while the value is empty: the field's hint. */
  placeholder?: string;
  /** Hint colour, 0xRRGGBBAA, where the host can apply it. */
  placeholderColor?: number;
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
  /** The scene type the editor replaces: size in logical units, 0xRRGGBBAA. */
  fontSize?: number;
  color?: number;
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

/** `0xRRGGBBAA` as the CSS colour the browser takes. */
const cssColor = (value: number): string =>
  `rgba(${(value >>> 24) & 0xff}, ${(value >>> 16) & 0xff}, ${
    (value >>> 8) & 0xff
  }, ${((value & 0xff) / 0xff).toFixed(3)})`;

/**
 * The stylesheet every editor of a host shares: the browser styles a
 * placeholder with its own grey unless a rule says otherwise, and the scene
 * draws the hint in the theme's muted colour. The colour itself travels on
 * each input as a custom property, so one rule serves every field.
 */
const PLACEHOLDER_RULE =
  'input.solid-editor::placeholder,textarea.solid-editor::placeholder{' +
  'color:var(--solid-placeholder,rgba(128,128,128,0.54));opacity:1;}';

/** Parents whose placeholder rule has been installed, at most once each. */
const styledParents = new WeakSet<HTMLElement>();

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
      if (purpose === 'number' || purpose === 'one-time-code')
        input.setAttribute('inputmode', 'numeric');
      if (purpose === 'search') input.setAttribute('enterkeyhint', 'search');
      input.name = purpose;
      input.className = 'solid-editor';
      if (options.placeholder !== undefined)
        input.placeholder = options.placeholder;
      input.setAttribute('aria-label', options.label);
      input.setAttribute(
        'autocomplete',
        purpose === 'search' || purpose === 'text' ? 'on' : purpose,
      );
      input.value = options.value ?? '';
      // The editor replaces a field the scene drew: no chrome of its own, the
      // scene's type size and colour, so focusing causes no visible reflow.
      const family = Config.fontSettings.fontFamily;
      const size = options.fontSize ?? 16;
      input.style.cssText =
        'position:absolute;box-sizing:border-box;margin:0;padding:0;' +
        'pointer-events:auto;background:transparent;border:none;outline:none;' +
        (family !== undefined ? `font-family:${String(family)};` : '') +
        `font-size:${size}px;line-height:${Math.round(size * 1.35)}px;` +
        (options.color !== undefined
          ? `color:${cssColor(options.color)};caret-color:${cssColor(
              options.color,
            )};`
          : '');
      if (options.placeholderColor !== undefined)
        input.style.setProperty(
          '--solid-placeholder',
          cssColor(options.placeholderColor),
        );
      const ownerDocument = input.ownerDocument;
      if (
        options.placeholderColor !== undefined &&
        !styledParents.has(parent) &&
        ownerDocument !== null
      ) {
        styledParents.add(parent);
        const style = ownerDocument.createElement('style');
        style.textContent = PLACEHOLDER_RULE;
        ownerDocument.head.appendChild(style);
      }
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
          return;
        }
        // Escape ends editing and hands the key back to the scene, so an
        // open field never traps the dialog-close key while a page listens.
        if (key.key === 'Escape' && !key.isComposing) {
          key.preventDefault();
          input.blur();
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
