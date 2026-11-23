import { TextField, TextView } from '@nativescript/core';

export function nativeEditorHost(root, target) {
  const apple = target === 'ios' || target === 'apple-tv';
  // The one editor that has the keyboard. The scene tells its editor to blur
  // when focus moves to another control; a tap that hits nothing focusable
  // reaches no scene handler at all, so the host ends editing here too — the
  // system's own rule (UIKit: tapping a control that doesn't take text
  // dismisses the keyboard) for the empty parts of a form.
  let active = undefined;
  const blurActive = () => {
    const editor = active;
    active = undefined;
    editor?.blur();
  };
  const insideActive = (x, y) => {
    const rect = active?.rect;
    return (
      rect !== undefined &&
      x >= rect.x &&
      y >= rect.y &&
      x < rect.x + rect.width &&
      y < rect.y + rect.height
    );
  };
  if (apple) {
    // UIKit: a recogniser on the root sees taps in every descendant. It must
    // not cancel the touches it sees, or the scene's own touch handling — and
    // the editor's caret placement — would die with it.
    root.on('gestureAttached', (e) => {
      try {
        if (e.ios) e.ios.cancelsTouchesInView = false;
      } catch {
        // The host refuses the flag: taps still reach the scene, only less.
      }
    });
    root.on('tap', (args) => {
      if (active === undefined) return;
      try {
        const at = args.ios.locationInView(root.ios);
        if (!insideActive(at.x, at.y)) blurActive();
      } catch {
        // No location, no guess: the scene's own paths still blur.
      }
    });
  } else {
    // Android bubbles every touch up the NativeScript tree (the framework's
    // handleGestureTouch), so the root sees scene taps and taps on the editor
    // itself. Raw coordinates are absolute whatever view the touch began in.
    root.on('touch', (e) => {
      if (active === undefined || e.action !== 'down') return;
      try {
        const location = Array.create('int', 2);
        root.android.getLocationOnScreen(location);
        const density = root.android.getResources().getDisplayMetrics().density;
        const x = (e.android.getRawX() - location[0]) / density;
        const y = (e.android.getRawY() - location[1]) / density;
        if (!insideActive(x, y)) blurActive();
      } catch {
        // No location, no guess: the scene's own paths still blur.
      }
    });
  }
  return {
    createEditor(options) {
      const purpose = options.purpose ?? 'text',
        secret = purpose.endsWith('password');
      if (secret && options.multiline)
        throw new Error('Password fields must be single line');
      const field = options.multiline ? new TextView() : new TextField();
      field.accessibilityLabel = options.label;
      // The scene's label sits above the field; the hint belongs inside it,
      // where the host draws it while the value is empty.
      if (options.placeholder !== undefined) field.hint = options.placeholder;
      if (secret) field.secure = true;
      if (purpose === 'email') field.keyboardType = 'email';
      // The keyboard the content asks for: a number pad, not the OTP layout
      // a one-time code uses.
      else if (purpose === 'number' || purpose === 'one-time-code')
        field.keyboardType = 'number';
      // The Return key says what it does; search submits from the keyboard.
      if (purpose === 'search' && !options.multiline)
        field.returnKeyType = 'search';
      else if (!options.multiline) field.returnKeyType = 'done';
      field.text = options.value ?? '';
      field.horizontalAlignment = 'left';
      field.verticalAlignment = 'top';
      const hints = {
        username: 'username',
        'current-password': 'password',
        'new-password': 'newPassword',
        email: 'emailAddress',
        'one-time-code': 'smsOTPCode',
      };
      const cssColor = (value) => {
        const rgb = (value >>> 8) & 0xffffff;
        return '#' + rgb.toString(16).padStart(6, '0');
      };
      const loaded = () => {
        // The editor stands in for a field the scene drew: no Android
        // underline, no default padding, the scene's type.
        try {
          if (options.fontSize) field.fontSize = options.fontSize;
          if (options.color !== undefined)
            field.color = cssColor(options.color);
          if (!apple && field.android) {
            field.android.setBackground(null);
            field.android.setPadding(0, 0, 0, 0);
            field.android.setIncludeFontPadding(false);
            if (options.placeholderColor !== undefined) {
              const rgba = options.placeholderColor >>> 0;
              const argb = ((rgba & 0xff) << 24) | ((rgba >>> 8) & 0xffffff);
              field.android.setHintTextColor(argb);
            }
            field.android.setGravity(
              (options.multiline
                ? android.view.Gravity.TOP
                : android.view.Gravity.CENTER_VERTICAL) |
                android.view.Gravity.START,
            );
          } else if (apple && field.ios) {
            field.backgroundColor = 'transparent';
            // The hint in the scene's muted colour: the system default is
            // its own grey, and the field's hint should hand over unchanged.
            if (
              options.placeholder !== undefined &&
              options.placeholderColor !== undefined
            ) {
              const rgba = options.placeholderColor >>> 0;
              const color = UIColor.colorWithRedGreenBlueAlpha(
                ((rgba >>> 24) & 0xff) / 255,
                ((rgba >>> 16) & 0xff) / 255,
                ((rgba >>> 8) & 0xff) / 255,
                (rgba & 0xff) / 255,
              );
              field.ios.attributedPlaceholder =
                NSAttributedString.alloc().initWithStringAttributes(
                  options.placeholder,
                  { NSColor: color },
                );
            }
          }
        } catch {
          // Styling is cosmetic: a host that refuses it still edits.
        }
        // A clear button is a standard iOS single-line affordance.
        if (apple && field.ios && !options.multiline) {
          field.ios.clearButtonMode = 1; // whileEditing
        }
        if (apple && field.ios && hints[purpose]) {
          field.ios.textContentType =
            purpose === 'one-time-code' ? 'oneTimeCode' : hints[purpose];
        } else if (
          !apple &&
          field.android &&
          android.os.Build.VERSION.SDK_INT >= 26 &&
          hints[purpose]
        ) {
          const ids = Array.create(java.lang.String, 1);
          ids[0] = hints[purpose];
          field.android.setAutofillHints(ids);
        }
      };
      const changed = () => options.onChange(field.text ?? '');
      const submit = () => {
        options.onSubmit?.(field.text ?? '');
        if (options.blurOnSubmit === true && !options.multiline) {
          field.dismissSoftInput();
          if (apple) field.ios?.resignFirstResponder();
          else field.android?.clearFocus();
        }
      };
      const blurred = () => {
        if (active !== undefined && active.field === field) active = undefined;
        field.visibility = 'collapsed';
        options.onBlur?.();
      };
      field.on('loaded', loaded);
      field.on('textChange', changed);
      field.on('returnPress', submit);
      field.on('blur', blurred);
      field.visibility = 'collapsed';
      root.addChild(field);
      const editor = {
        // The editor's box in the root's coordinates, the same rect the tap
        // test reads.
        rect: { x: 0, y: 0, width: 0, height: 0 },
        field,
        focus() {
          field.visibility = 'visible';
          field.focus();
          active = editor;
          if (!apple && field.android) {
            field.android.post(
              new java.lang.Runnable({
                run() {
                  field.android
                    ?.getContext()
                    .getSystemService('input_method')
                    .showSoftInput(field.android, 1);
                },
              }),
            );
          }
        },
        blur() {
          if (active === editor) active = undefined;
          // Dismiss while the view still has focus and a window token: the
          // framework's own dismiss bails out on a view that has none, so
          // collapsing first could leave the keyboard standing.
          field.dismissSoftInput();
          if (apple) field.ios?.resignFirstResponder();
          else field.android?.clearFocus();
          field.visibility = 'collapsed';
        },
        value: () => field.text ?? '',
        setValue(value) {
          if (field.text !== value) field.text = value;
        },
        setBounds({ x, y, width, height }) {
          editor.rect.x = x;
          editor.rect.y = y;
          editor.rect.width = width;
          editor.rect.height = height;
          field.marginLeft = x;
          field.marginTop = y;
          field.width = width;
          field.height = height;
        },
        dispose() {
          // A screen change removes a field mid-edit; the keyboard it raised
          // goes with it rather than outliving its field.
          if (active === editor) editor.blur();
          field.off('loaded', loaded);
          field.off('textChange', changed);
          field.off('returnPress', submit);
          field.off('blur', blurred);
          root.removeChild(field);
          field.text = '';
        },
      };
      return editor;
    },
  };
}
