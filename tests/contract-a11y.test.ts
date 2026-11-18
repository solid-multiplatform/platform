import * as v from 'vitest';
import {
  auditSemantics,
  ensureTouchTarget,
  meetsTouchTarget,
  MIN_TOUCH_TARGET,
  readingOrder,
} from '../src/sdk/a11y.js';
import { browserSemantics, type Semantics } from '../src/sdk/semantics.js';

const rect = (x: number, y: number, width = 48, height = 48) => ({
  x,
  y,
  width,
  height,
});

v.describe('touch targets', () => {
  v.it('checks and expands to the platform minimum', () => {
    v.expect(MIN_TOUCH_TARGET).toBe(44);
    v.expect(meetsTouchTarget(rect(0, 0, 44, 44))).toBe(true);
    v.expect(meetsTouchTarget(rect(0, 0, 43, 60))).toBe(false);
    v.expect(meetsTouchTarget(rect(0, 0, 22, 22), { scale: 2 })).toBe(false);
    v.expect(meetsTouchTarget(rect(0, 0, 48, 48), { scale: 2 })).toBe(false);
    v.expect(ensureTouchTarget(rect(100, 100, 20, 20))).toEqual({
      x: 88,
      y: 88,
      width: 44,
      height: 44,
    });
    const wide = ensureTouchTarget({ x: 0, y: 0, width: 80, height: 10 });
    v.expect(wide.width).toBe(80);
    v.expect(wide.height).toBe(44);
  });
});

v.describe('auditSemantics', () => {
  v.it('accepts a complete semantics node', () => {
    const issues = auditSemantics([
      {
        role: 'button',
        label: 'Save',
        bounds: () => rect(0, 0),
        activate: () => {},
      },
    ]);
    v.expect(issues).toEqual([]);
  });

  v.it('reports labels, states, values, heading levels and actions', () => {
    const issues = auditSemantics([
      { role: 'heading', label: '' },
      { role: 'heading', label: 'Title', level: 9 },
      { role: 'switch', label: 'Wifi' },
      { role: 'slider', label: 'Volume', now: 11, min: 0, max: 10 },
      { role: 'progressbar', label: 'Loading' },
      { role: 'button', label: 'Open' },
      {
        role: 'button',
        label: 'Tiny',
        bounds: () => rect(0, 0, 20, 20),
        activate: () => {},
      },
    ]);
    v.expect(issues.map((issue) => issue.rule)).toEqual([
      'label',
      'heading-level',
      'heading-level',
      'state',
      'action',
      'value',
      'value',
      'action',
      'touch-target',
    ]);
    v.expect(issues[0]!.message).toContain('missing an accessible label');
    v.expect(issues[8]!.message).toContain('expected at least 44');
  });

  v.it('can audit bounds supplied separately and skip action checks', () => {
    const nodes: Semantics[] = [
      { role: 'button', label: 'Open' },
      { role: 'textbox', label: 'Name' },
    ];
    const issues = auditSemantics(nodes, {
      requireAction: false,
      bounds: (node) =>
        node.role === 'button' ? rect(0, 0, 10, 10) : undefined,
    });
    v.expect(issues.map((issue) => issue.rule)).toEqual(['touch-target']);
  });

  v.it('does not require actions from disabled controls', () => {
    const issues = auditSemantics([
      { role: 'button', label: 'Buy', disabled: true },
    ]);
    v.expect(issues).toEqual([]);
  });
});

v.describe('reading order', () => {
  v.it('orders rows top-to-bottom and columns by direction', () => {
    const items = [
      { id: 'bottom-right', bounds: () => rect(200, 200) },
      { id: 'top-right', bounds: () => rect(200, 10) },
      { id: 'top-left', bounds: () => rect(10, 10) },
      { id: 'bottom-left', bounds: () => rect(10, 200) },
    ];
    v.expect(readingOrder(items).map((item) => item.id)).toEqual([
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ]);
    v.expect(readingOrder(items, 'rtl').map((item) => item.id)).toEqual([
      'top-right',
      'top-left',
      'bottom-right',
      'bottom-left',
    ]);
  });

  v.it('keeps visually aligned controls in the same row', () => {
    const items = [
      { id: 'b', bounds: () => rect(200, 100) },
      { id: 'a', bounds: () => rect(10, 104) },
    ];
    v.expect(readingOrder(items).map((item) => item.id)).toEqual(['a', 'b']);
    v.expect(readingOrder(items, 'rtl').map((item) => item.id)).toEqual([
      'b',
      'a',
    ]);
  });
});

v.describe('browserSemantics', () => {
  v.it('mirrors roles, states, values and actions into a hidden tree', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const semantics = browserSemantics(root);
    const activations: string[] = [];
    let node: Semantics = {
      role: 'tab',
      label: 'Library',
      selected: true,
      expanded: false,
      description: 'Shows saved items',
      bounds: () => rect(0, 0),
      activate: () => activations.push('library'),
    };
    const handle = semantics.register(node);
    const el = root.querySelector('[role="tab"]')!;
    v.expect(el.getAttribute('aria-label')).toBe('Library');
    v.expect(el.getAttribute('aria-selected')).toBe('true');
    v.expect(el.getAttribute('aria-expanded')).toBe('false');
    v.expect(el.getAttribute('aria-description')).toBe('Shows saved items');

    node = { ...node, selected: false, value: '3 items' };
    handle.update(node);
    v.expect(el.getAttribute('aria-selected')).toBe('false');
    v.expect(el.getAttribute('aria-valuetext')).toBe('3 items');

    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    v.expect(activations).toEqual(['library']);

    const slider = semantics.register({
      role: 'slider',
      label: 'Volume',
      min: 0,
      max: 100,
      now: 25,
    });
    const sliderEl = root.querySelector('[role="slider"]')!;
    v.expect(sliderEl.getAttribute('aria-valuemin')).toBe('0');
    v.expect(sliderEl.getAttribute('aria-valuemax')).toBe('100');
    v.expect(sliderEl.getAttribute('aria-valuenow')).toBe('25');

    slider.dispose();
    handle.dispose();
    semantics.dispose();
    v.expect(root.children).toHaveLength(0);
    root.remove();
  });
});
