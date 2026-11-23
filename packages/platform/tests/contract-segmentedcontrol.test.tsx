// Contract tests: SegmentedControl — Apple's segmented control on a scene:
// equal segments, one choice, Enter/click selects on a pointer host, focus
// alone selects on a remote host (tvOS), disabled segments are skipped.
import * as v from 'vitest';
import { createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import {
  SegmentedControl,
  useFocusManager,
  type KeyEventTarget,
} from '@solid-multiplatform/platform/primitives';
import type {
  SegmentOption,
  SegmentedControlProps,
} from '../src/primitives/SegmentedControl.js';
import { renderer } from './setup.js';

const keys = new EventTarget();
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface Option extends SegmentOption<string> {}

const OPTIONS: readonly Option[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

interface Mounted {
  control: lng.ElementNode;
  dispose(): void;
}

async function mountControl(
  props: Partial<SegmentedControlProps<string>> & {
    value: string | (() => string);
    onChange?(value: string): void;
  },
): Promise<Mounted> {
  let control!: lng.ElementNode;
  let dispose!: () => void;
  dispose = renderer.render(() => {
    useFocusManager(undefined, keys as unknown as KeyEventTarget);
    return (
      <view width={400} height={100} clipping>
        <SegmentedControl
          ref={(el: lng.ElementNode) => (control = el)}
          width={360}
          label="Range"
          options={props.options ?? OPTIONS}
          value={props.value}
          onChange={props.onChange}
        />
      </view>
    );
  }) as unknown as () => void;
  await tick();
  return { control, dispose };
}

const segment = (control: lng.ElementNode, index: number): lng.ElementNode =>
  control.children[index] as lng.ElementNode;

const click = (node: lng.ElementNode) =>
  node.onMouseClick?.({ x: 0, y: 0 } as never, node);

v.describe('SegmentedControl', () => {
  v.beforeEach(() => lng.setCapabilities('android'));
  v.afterEach(() => lng.resetCapabilities());

  v.test('divides its width equally', async () => {
    const m = await mountControl({ value: 'day' });
    try {
      v.expect(m.control.width).toBe(360);
      v.expect(m.control.role).toBe('group');
      v.expect(m.control.ariaLabel).toBe('Range');
      for (let i = 0; i < OPTIONS.length; i++) {
        v.expect(segment(m.control, i).width).toBeCloseTo(120, 5);
      }
    } finally {
      m.dispose();
    }
  });

  v.test(
    'the value segment draws selected; Enter and click select',
    async () => {
      const [value, setValue] = createSignal('day');
      const m = await mountControl({ value: value, onChange: setValue });
      try {
        v.expect(segment(m.control, 0).ariaChecked).toBe(true);
        v.expect(segment(m.control, 1).ariaChecked).toBe(false);
        segment(m.control, 1).onEnter?.();
        v.expect(value()).toBe('week');
        v.expect(segment(m.control, 1).ariaChecked).toBe(true);
        click(segment(m.control, 2));
        v.expect(value()).toBe('month');
        // Re-clicking the selected segment changes nothing.
        click(segment(m.control, 2));
        v.expect(value()).toBe('month');
      } finally {
        m.dispose();
      }
    },
  );

  v.test(
    'the group lands focus on the value and routes Left/Right',
    async () => {
      const m = await mountControl({ value: 'week' });
      try {
        v.expect(m.control.selected).toBe(1);
        v.expect(m.control.onLeft).toBeTypeOf('function');
        v.expect(m.control.onRight).toBeTypeOf('function');
        v.expect(m.control.forwardFocus).toBeTypeOf('function');
      } finally {
        m.dispose();
      }
    },
  );

  v.test(
    'a disabled segment is skipped by focus and cannot select',
    async () => {
      const [value, setValue] = createSignal('day');
      const m = await mountControl({
        value: value,
        onChange: setValue,
        options: [
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week', disabled: true },
        ],
      });
      try {
        const disabled = segment(m.control, 1);
        v.expect(disabled.skipFocus).toBe(true);
        v.expect(disabled.ariaDisabled).toBe(true);
        disabled.onEnter?.();
        click(disabled);
        v.expect(value()).toBe('day');
      } finally {
        m.dispose();
      }
    },
  );

  v.test('on a remote host, focus alone selects', async () => {
    lng.setCapabilities('roku');
    const [value, setValue] = createSignal('day');
    const m = await mountControl({ value: value, onChange: setValue });
    try {
      // tvOS: moving focus to a segment selects it, without Enter.
      segment(m.control, 2).onFocus?.();
      v.expect(value()).toBe('month');
      // Focusing the selected one again changes nothing.
      segment(m.control, 2).onFocus?.();
      v.expect(value()).toBe('month');
    } finally {
      m.dispose();
      lng.resetCapabilities();
    }
  });

  v.test('a controlled value change redraws the selection', async () => {
    const [value, setValue] = createSignal('day');
    const m = await mountControl({ value: value });
    try {
      v.expect(segment(m.control, 0).ariaChecked).toBe(true);
      setValue('month');
      await tick();
      v.expect(segment(m.control, 2).ariaChecked).toBe(true);
      v.expect(segment(m.control, 0).ariaChecked).toBe(false);
    } finally {
      m.dispose();
    }
  });
});
