import { TextField, TextView } from '@nativescript/core';

export function nativeEditorHost(root, target) {
  const apple = target === 'ios' || target === 'apple-tv';
  return {
    createEditor(options) {
      const purpose = options.purpose ?? 'text',
        secret = purpose.endsWith('password');
      if (secret && options.multiline)
        throw new Error('Password fields must be single line');
      const field = options.multiline ? new TextView() : new TextField();
      field.accessibilityLabel = options.label;
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
      const loaded = () => {
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
      const blurred = () => options.onBlur?.();
      field.on('loaded', loaded);
      field.on('textChange', changed);
      field.on('returnPress', submit);
      field.on('blur', blurred);
      root.addChild(field);
      return {
        focus() {
          field.focus();
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
          field.dismissSoftInput();
          if (apple) field.ios?.resignFirstResponder();
          else field.android?.clearFocus();
        },
        value: () => field.text ?? '',
        setValue(value) {
          if (field.text !== value) field.text = value;
        },
        setBounds({ x, y, width, height }) {
          field.marginLeft = x;
          field.marginTop = y;
          field.width = width;
          field.height = height;
        },
        dispose() {
          field.off('loaded', loaded);
          field.off('textChange', changed);
          field.off('returnPress', submit);
          field.off('blur', blurred);
          root.removeChild(field);
          field.text = '';
        },
      };
    },
  };
}
