import { browserEditorHost } from './editor.js';
import type { ControlSurface, ControlProps } from './controls.jsx';

export function browserControls(parent: HTMLElement): ControlSurface {
  return {
    ...browserEditorHost(parent),
    create(kind) {
      const el = document.createElement(
        kind === 'button'
          ? 'button'
          : kind === 'progress'
            ? 'progress'
            : kind === 'label'
              ? 'span'
              : 'input',
      );
      if (el instanceof HTMLButtonElement) el.type = 'button';
      if (el instanceof HTMLInputElement) {
        el.type = kind === 'slider' ? 'range' : 'checkbox';
        if (kind === 'switch') el.setAttribute('role', 'switch');
      }
      el.style.cssText =
        'position:absolute;box-sizing:border-box;pointer-events:auto';
      parent.appendChild(el);
      let current: ControlProps;
      el.addEventListener('click', () => current?.onActivate?.());
      el.addEventListener('input', () => {
        if (el instanceof HTMLInputElement)
          current?.onValue?.(
            kind === 'switch' ? Number(el.checked) : el.valueAsNumber,
          );
      });
      return {
        focus: () => el.focus(),
        dispose: () => el.remove(),
        update(props) {
          current = props;
          const { x, y, width, height } = props.bounds;
          Object.assign(el.style, {
            left: x + 'px',
            top: y + 'px',
            width: width + 'px',
            height: height + 'px',
          });
          el.setAttribute('aria-label', props.label);
          if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement)
            el.disabled = !!props.disabled;
          if (kind === 'label' || kind === 'button')
            el.textContent = props.label;
          if (el instanceof HTMLProgressElement) {
            el.max = props.max ?? 100;
            if (props.value === undefined) el.removeAttribute('value');
            else el.value = props.value;
          }
          if (el instanceof HTMLInputElement && kind === 'switch')
            el.checked = !!props.value;
          if (el instanceof HTMLInputElement && kind === 'slider') {
            el.min = String(props.min ?? 0);
            el.max = String(props.max ?? 100);
            el.value = String(props.value ?? 0);
          }
        },
      };
    },
  };
}

/** Native dialog owns Tab containment and focus restoration, including Escape/cancel. */
export function openWebDialog(parent: HTMLElement, label: string) {
  const previous = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', label);
  parent.appendChild(dialog);
  dialog.showModal();
  const restore = () => {
    dialog.remove();
    if (previous instanceof HTMLElement && previous.isConnected)
      previous.focus();
  };
  dialog.addEventListener('close', restore, { once: true });
  return {
    element: dialog,
    surface: browserControls(dialog),
    close: () => {
      if (dialog.open) dialog.close();
    },
  };
}
