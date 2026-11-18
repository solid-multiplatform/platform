import { createSignal, type Accessor } from 'solid-js';

export type FormValues = Record<string, string>;
export type FormErrors = Record<string, string | undefined>;

export interface FormOptions {
  initial?: FormValues;
  /**
   * Return one message per invalid field. An empty string or `undefined`
   * means the field is valid.
   */
  validate?(values: FormValues): FormErrors;
}

export interface FormField {
  value(): string;
  error(): string | undefined;
  set(value: string): void;
  blur(): void;
}

export interface Form {
  values: Accessor<FormValues>;
  errors: Accessor<FormErrors>;
  submitting: Accessor<boolean>;
  field(name: string): FormField;
  setValue(name: string, value: string): void;
  touch(name: string): void;
  validate(): boolean;
  reset(): void;
  submit(
    run: (values: FormValues) => unknown | Promise<unknown>,
  ): Promise<boolean>;
}

/**
 * Small controlled-form helper. Mirrors the established pattern used by
 * React Hook Form / Formik / Flutter `Form`: values are controlled, a field
 * shows its error after it has been touched, and submit validates first.
 *
 * It is renderer-agnostic: bind it to native `TextField`s, browser controls or
 * a scene-drawn editor without per-platform code.
 */
export function createForm(options: FormOptions = {}): Form {
  const initial = { ...(options.initial ?? {}) };
  const [values, setValues] = createSignal<FormValues>({ ...initial });
  const [errors, setErrors] = createSignal<FormErrors>({});
  const [submitting, setSubmitting] = createSignal(false);
  const touched = new Set<string>();

  const validate = (): boolean => {
    const next = options.validate?.(values()) ?? {};
    setErrors(next);
    return !Object.values(next).some(Boolean);
  };

  const setValue = (name: string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    if (touched.has(name) && options.validate) {
      const next = options.validate({ ...values(), [name]: value });
      setErrors((current) => ({ ...current, [name]: next[name] }));
    }
  };

  const touch = (name: string) => {
    touched.add(name);
    if (options.validate) {
      const next = options.validate(values());
      setErrors((current) => ({ ...current, [name]: next[name] }));
    }
  };

  return {
    values,
    errors,
    submitting,
    field(name) {
      return {
        value: () => values()[name] ?? '',
        error: () => errors()[name],
        set: (value) => setValue(name, value),
        blur: () => touch(name),
      };
    },
    setValue,
    touch,
    validate,
    reset() {
      touched.clear();
      setValues({ ...initial });
      setErrors({});
    },
    async submit(run) {
      for (const name of Object.keys(values())) touched.add(name);
      if (!validate()) return false;
      setSubmitting(true);
      try {
        await run(values());
        return true;
      } finally {
        setSubmitting(false);
      }
    },
  };
}
