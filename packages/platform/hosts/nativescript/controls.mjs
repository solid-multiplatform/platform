import { Button, Switch, Slider, Progress, Label } from '@nativescript/core';
import { nativeEditorHost } from './editors.mjs';
const views = {
  button: Button,
  switch: Switch,
  slider: Slider,
  progress: Progress,
  label: Label,
};
export function nativeControls(root, target) {
  return {
    ...nativeEditorHost(root, target),
    create(kind) {
      const view = new views[kind]();
      view.horizontalAlignment = 'left';
      view.verticalAlignment = 'top';
      root.addChild(view);
      let current,
        updating = false;
      const tap = () => current?.onActivate?.();
      const changed = (e) => {
        if (!updating) current?.onValue?.(Number(e.value));
      };
      view.on('tap', tap);
      const valueEvent = kind === 'switch' ? 'checkedChange' : 'valueChange';
      view.on(valueEvent, changed);
      return {
        focus: () => view.focus(),
        dispose() {
          view.off('tap', tap);
          view.off(valueEvent, changed);
          root.removeChild(view);
        },
        update(props) {
          current = props;
          updating = true;
          try {
            const { x, y, width, height } = props.bounds;
            view.marginLeft = x;
            view.marginTop = y;
            view.width = width;
            view.height = height;
            view.accessibilityLabel = props.label;
            view.isEnabled = !props.disabled;
            if (kind === 'label' || kind === 'button') view.text = props.label;
            if (kind === 'switch') view.checked = !!props.value;
            if (kind === 'slider') {
              view.minValue = props.min ?? 0;
              view.maxValue = props.max ?? 100;
              view.value = props.value ?? 0;
            }
            if (kind === 'progress') {
              view.maxValue = props.max ?? 100;
              view.value = props.value ?? 0;
            }
          } finally {
            updating = false;
          }
        },
      };
    },
  };
}
