import * as v from 'vitest';
import { createRoot, createSignal, type Setter } from 'solid-js';
import { useTransition, type TransitionValues } from '../src/sdk/transition.js';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const mountTransition = (
  options: Parameters<typeof useTransition>[0],
): {
  values: TransitionValues;
  setWhen: Setter<boolean>;
  dispose: () => void;
} => {
  let values!: TransitionValues;
  let setWhen!: Setter<boolean>;
  let dispose!: () => void;
  createRoot((stop) => {
    dispose = stop;
    const [when, set] = createSignal(true);
    setWhen = set;
    values = useTransition({ ...options, when });
  });
  return { values, setWhen, dispose };
};

v.describe('useTransition', () => {
  v.it('enters and exits instantly when reduced motion is on', async () => {
    let exited = 0;
    const { values, setWhen, dispose } = mountTransition({
      type: 'slide-up',
      distance: 20,
      duration: 0,
      onExited: () => exited++,
    });
    v.expect(values.mounted()).toBe(true);
    v.expect(values.progress()).toBe(1);
    v.expect(values.alpha()).toBe(1);
    v.expect(values.y()).toBe(0);

    setWhen(false);
    await tick();
    v.expect(values.mounted()).toBe(false);
    v.expect(values.progress()).toBe(0);
    v.expect(values.alpha()).toBe(0);
    v.expect(values.y()).toBe(20);
    v.expect(exited).toBe(1);

    setWhen(true);
    await tick();
    v.expect(values.mounted()).toBe(true);
    v.expect(values.y()).toBe(0);
    dispose();
  });

  v.it('computes slide direction and scale values', async () => {
    const down = mountTransition({ type: 'slide-down', duration: 0 });
    down.setWhen(false);
    await tick();
    v.expect(down.values.y()).toBe(-24);

    const scale = mountTransition({ type: 'scale', duration: 0 });
    scale.setWhen(false);
    await tick();
    v.expect(scale.values.scale()).toBeCloseTo(0.96, 5);
    v.expect(scale.values.y()).toBe(0);

    down.dispose();
    scale.dispose();
  });

  it_starts_hidden();
});

function it_starts_hidden() {
  v.it('starts unmounted when `when` is false', () => {
    let values!: TransitionValues;
    let dispose!: () => void;
    createRoot((stop) => {
      dispose = stop;
      values = useTransition({ when: false, duration: 0 });
    });
    v.expect(values.mounted()).toBe(false);
    v.expect(values.alpha()).toBe(0);
    dispose();
  });
}
