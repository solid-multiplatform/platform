/** A focus scope survives virtualization through stable item keys. */
export function createFocusScope<K>(
  options: { restore?: () => void; wrap?: boolean } = {},
) {
  const entries = new Map<K, { focus(): void; disabled?(): boolean }>();
  let key: K | undefined,
    closed = false;
  function focus(value: K) {
    const entry = entries.get(value);
    if (closed || !entry || entry.disabled?.()) return false;
    key = value;
    entry.focus();
    return true;
  }
  function move(delta: number) {
    const available = [...entries]
      .filter(([, e]) => !e.disabled?.())
      .map(([k]) => k);
    if (!available.length || !delta) return false;
    const position = key === undefined ? -1 : available.indexOf(key);
    const start = position < 0 ? (delta > 0 ? -1 : available.length) : position;
    const index =
      options.wrap === false
        ? Math.max(0, Math.min(available.length - 1, start + delta))
        : (((start + delta) % available.length) + available.length) %
          available.length;
    return focus(available[index]!);
  }
  return {
    focus,
    move,
    selected: () => key,
    register(value: K, entry: { focus(): void; disabled?(): boolean }) {
      if (closed) throw new Error('Focus scope is closed');
      entries.set(value, entry);
      if (key === value && !entry.disabled?.()) entry.focus();
      return () => {
        if (entries.get(value) === entry) entries.delete(value);
      };
    },
    close() {
      if (!closed) {
        closed = true;
        entries.clear();
        options.restore?.();
      }
    },
  };
}
