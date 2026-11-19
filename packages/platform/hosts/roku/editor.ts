import type {
  EditorHost,
  EditorOptions,
} from '@solid-multiplatform/platform/editor';
import type { NativeTextPort } from './native-text-types';

/** SceneGraph uses a modal editor. Position the activating control in the app's scene. */
export function rokuEditorHost(
  port: NativeTextPort,
  unavailable: (reason: string) => void,
): EditorHost {
  return {
    createEditor(options: EditorOptions) {
      let value = options.value ?? '',
        active: ReturnType<NativeTextPort['open']> | undefined;
      const close = () => {
        active?.close();
        active = undefined;
      };
      return {
        focus() {
          close();
          const before = value;
          active = port.open({
            title: options.label,
            initial: value,
            numeric: options.purpose === 'one-time-code',
            secret: options.purpose?.endsWith('password') ?? false,
            // The keyboard layout and what voice entry listens for. A
            // password gets its own domain from `secret`.
            domain: options.purpose === 'email' ? 'email' : undefined,
            maximumLength: 1024,
            confirm: 'Done',
            change(next) {
              value = next;
              options.onChange(next);
            },
            done(next) {
              value = next;
              options.onChange(next);
              options.onSubmit?.(next);
              options.onBlur?.();
              active = undefined;
            },
            cancel() {
              value = before;
              options.onChange(value);
              options.onBlur?.();
              active = undefined;
            },
            failed() {
              active = undefined;
              unavailable('Native Roku editor unavailable');
            },
          });
        },
        blur: close,
        value: () => value,
        setValue(next) {
          value = next;
        },
        setBounds() {
          /* OS sizes the dialog. */
        },
        dispose() {
          close();
          value = '';
        },
      };
    },
  };
}
