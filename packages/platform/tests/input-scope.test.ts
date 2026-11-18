import { test, expect, vi } from 'vitest';
import { createInputScope } from '../src/sdk/input.js';

test('capture, hold and a cancelled/recycled row cannot activate on release', () => {
  vi.useFakeTimers();
  try {
    const input = createInputScope(),
      activate = vi.fn(),
      hold = vi.fn(),
      drag = vi.fn(),
      at = { x: 2, y: 2 };
    const remove = input.register({
      bounds: () => ({ x: 0, y: 0, width: 10, height: 10 }),
      activate,
      hold,
      drag,
    });
    input.down(1, at);
    input.move(1, { x: 22, y: 12 });
    input.up(1, at);
    expect(drag.mock.calls.map((c) => c[0])).toEqual(['start', 'move', 'end']);
    input.down(2, at);
    vi.advanceTimersByTime(600);
    input.up(2, at);
    expect(hold).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
    input.down(1, at);
    input.cancelAll();
    input.up(1, at);
    input.down(1, at);
    remove();
    vi.advanceTimersByTime(600);
    input.up(1, at);
    expect(activate).not.toHaveBeenCalled();
    expect(hold).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
