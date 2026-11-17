const keys = new Map([
  [19, 'ArrowUp'], [20, 'ArrowDown'], [21, 'ArrowLeft'], [22, 'ArrowRight'],
  [23, 'Enter'], [66, 'Enter'], [82, 'ContextMenu'], [85, 'MediaPlayPause'],
  [86, 'MediaStop'], [87, 'MediaTrackNext'], [88, 'MediaTrackPrevious'],
  [89, 'MediaRewind'], [90, 'MediaFastForward'], [126, 'MediaPlay'], [127, 'MediaPause']
]);

export const androidKey = code => keys.get(code);

/** Android repeats are ignored because KeyBridge owns the repeat clock. */
export function createInputController(bridge) {
  const consumed = new Set();
  return {
    key(action, code, repeat = 0) {
      const key = androidKey(code);
      if (!key || (action !== 0 && action !== 1)) return false;
      if (action === 0) {
        if (repeat > 0 || bridge.isDown(key)) return consumed.has(code);
        const handled = !(key.startsWith('Media') || key === 'ContextMenu' ? bridge.tap(key) : bridge.down(key));
        if (handled) consumed.add(code);
        return handled;
      }
      const handled = consumed.delete(code);
      bridge.up(key);
      return handled;
    },
    back() { return !bridge.tap('Backspace'); },
    release() { consumed.clear(); bridge.releaseAll(); }
  };
}
