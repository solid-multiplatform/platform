import * as v from 'vitest';
import * as lng from '@solid-multiplatform/platform';
import { GestureAlternatives } from '@solid-multiplatform/platform/primitives';
import {
  createGestureAlternatives,
  createPinchGesture,
  type PinchState,
} from '../src/sdk/gestures.js';
import { auditSemantics } from '../src/sdk/a11y.js';
import { renderer, waitForUpdate } from './setup.js';

const close = (value: number, expected: number, precision = 5) =>
  v.expect(value).toBeCloseTo(expected, precision);

v.describe('createPinchGesture', () => {
  v.it('tracks scale, rotation and centre movement for two pointers', () => {
    const starts: PinchState[] = [];
    const updates: PinchState[] = [];
    const ends: PinchState[] = [];
    const gesture = createPinchGesture({
      onStart: (state) => starts.push(state),
      onUpdate: (state) => updates.push(state),
      onEnd: (state) => ends.push(state),
    });

    gesture.pointerDown({ id: 1, x: 100, y: 100 });
    v.expect(gesture.state().active).toBe(false);
    v.expect(gesture.state().pointers).toHaveLength(1);

    gesture.pointerDown({ id: 2, x: 200, y: 100 });
    v.expect(gesture.state().active).toBe(true);
    v.expect(starts).toHaveLength(1);
    close(gesture.state().distance, 100);
    close(gesture.state().scale, 1);
    close(gesture.state().rotation, 0);
    v.expect(gesture.state().center).toEqual({ x: 150, y: 100 });

    gesture.pointerMove({ id: 2, x: 200, y: 200 });
    close(gesture.state().distance, Math.SQRT2 * 100);
    close(gesture.state().scale, Math.SQRT2);
    close(gesture.state().rotation, Math.PI / 4);
    v.expect(gesture.state().center).toEqual({ x: 150, y: 150 });
    v.expect(gesture.state().delta).toEqual({ x: 0, y: 50 });

    gesture.pointerMove({ id: 2, x: 100, y: 200 });
    close(gesture.state().rotation, Math.PI / 2);
    close(gesture.state().scale, 1);

    gesture.pointerUp({ id: 2, x: 100, y: 200 });
    v.expect(ends).toHaveLength(1);
    v.expect(gesture.state().active).toBe(false);
    close(updates.at(-1)!.rotation, Math.PI / 2);
    v.expect(starts).toHaveLength(1);
  });

  v.it('accumulates rotation across the ±π boundary', () => {
    const gesture = createPinchGesture();
    gesture.pointerDown({ id: 1, x: 100, y: 100 });
    gesture.pointerDown({ id: 2, x: 200, y: 100 });
    gesture.pointerMove({ id: 2, x: 100, y: 200 });
    close(gesture.state().rotation, Math.PI / 2);
    gesture.pointerMove({ id: 2, x: 0, y: 100 });
    close(gesture.state().rotation, Math.PI);
    gesture.pointerMove({ id: 2, x: 100, y: 0 });
    close(gesture.state().rotation, (Math.PI * 3) / 2);
    gesture.pointerCancel();
    v.expect(gesture.state().active).toBe(false);
  });

  v.it('ignores extra pointers and unknown ids', () => {
    const gesture = createPinchGesture();
    gesture.pointerDown({ id: 1, x: 0, y: 0 });
    gesture.pointerDown({ id: 2, x: 100, y: 0 });
    gesture.pointerDown({ id: 3, x: 50, y: 50 });
    gesture.pointerMove({ id: 3, x: 90, y: 90 });
    gesture.pointerMove({ id: 9, x: 10, y: 10 });
    v.expect(gesture.state().pointers.map((point) => point.id)).toEqual([1, 2]);
    close(gesture.state().scale, 1);
    gesture.pointerUp({ id: 9, x: 0, y: 0 });
    v.expect(gesture.state().active).toBe(true);
  });

  v.it('reports cancellation instead of end', () => {
    const cancels: PinchState[] = [];
    const ends: PinchState[] = [];
    const gesture = createPinchGesture({
      onCancel: (state) => cancels.push(state),
      onEnd: (state) => ends.push(state),
    });
    gesture.pointerDown({ id: 1, x: 0, y: 0 });
    gesture.pointerDown({ id: 2, x: 100, y: 0 });
    gesture.pointerMove({ id: 2, x: 120, y: 20 });
    gesture.pointerCancel(2);
    v.expect(cancels).toHaveLength(1);
    v.expect(ends).toHaveLength(0);
    v.expect(gesture.state().active).toBe(false);
  });

  v.it('keeps scale at 1 for coincident pointers', () => {
    const gesture = createPinchGesture();
    gesture.pointerDown({ id: 1, x: 50, y: 50 });
    gesture.pointerDown({ id: 2, x: 50, y: 50 });
    close(gesture.state().distance, 0);
    close(gesture.state().scale, 1);
    gesture.pointerMove({ id: 2, x: 100, y: 50 });
    close(gesture.state().distance, 50);
    close(gesture.state().scale, 1);
  });
});

v.describe('createGestureAlternatives', () => {
  v.it('runs enabled actions and exposes button semantics', () => {
    const calls: string[] = [];
    const alternatives = createGestureAlternatives([
      {
        id: 'zoom-in',
        label: 'Zoom in',
        run: () => calls.push('zoom-in'),
      },
      {
        id: 'reset',
        label: 'Reset',
        run: () => calls.push('reset'),
      },
      {
        id: 'locked',
        label: 'Locked',
        run: () => calls.push('locked'),
        disabled: true,
      },
    ]);
    v.expect(alternatives.labels()).toEqual(['Zoom in', 'Reset', 'Locked']);
    v.expect(alternatives.run('zoom-in')).toBe(true);
    v.expect(alternatives.run('locked')).toBe(false);
    v.expect(alternatives.run('missing')).toBe(false);
    v.expect(calls).toEqual(['zoom-in']);

    const bounds = (index: number) => ({
      x: 0,
      y: index * 48,
      width: 120,
      height: 48,
    });
    const semanticNodes = alternatives.semantics(bounds);
    v.expect(semanticNodes[0]).toMatchObject({
      role: 'button',
      label: 'Zoom in',
    });
    semanticNodes[1]!.activate?.();
    v.expect(calls).toEqual(['zoom-in', 'reset']);
    v.expect(auditSemantics(semanticNodes, { requireAction: true })).toEqual(
      [],
    );
  });
});

v.describe('GestureAlternatives', () => {
  v.it('renders focusable buttons and skips disabled actions', async () => {
    const calls: string[] = [];
    const dispose = renderer.render(() => (
      <view width={400} height={300}>
        <GestureAlternatives
          x={20}
          y={20}
          actions={[
            { id: 'in', label: 'Zoom in', run: () => calls.push('in') },
            {
              id: 'out',
              label: 'Zoom out',
              run: () => calls.push('out'),
              disabled: true,
            },
          ]}
        />
      </view>
    ));
    await waitForUpdate();
    const texts = (node: unknown): string[] => {
      const current = node as { text?: string; children?: readonly unknown[] };
      if (typeof current.text === 'string') return [current.text];
      return (current.children ?? []).flatMap((child) => texts(child));
    };
    const find = (
      node: unknown,
      label: string,
    ): lng.ElementNode | undefined => {
      if (!lng.isINode(node)) return undefined;
      if (
        lng.isElementNode(node) &&
        typeof node.onMouseClick === 'function' &&
        texts(node).includes(label)
      ) {
        return node;
      }
      for (const child of node.children) {
        const found = find(child, label);
        if (found) return found;
      }
      return undefined;
    };

    const zoomIn = find(renderer.rootNode, 'Zoom in')!;
    const zoomOut = find(renderer.rootNode, 'Zoom out')!;
    zoomIn.onMouseClick?.(new MouseEvent('click'), zoomIn);
    zoomOut.onMouseClick?.(new MouseEvent('click'), zoomOut);
    v.expect(calls).toEqual(['in']);
    dispose();
  });
});
