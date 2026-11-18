import type { Rect } from './input.js';
import type { Semantics, SemanticsRole } from './semantics.js';

/** Apple HIG 44pt / Android Material 48dp. 44 covers both at scene scale 1. */
export const MIN_TOUCH_TARGET = 44;

export interface TouchTargetOptions {
  /** Minimum edge in logical units. Defaults to 44. */
  minimum?: number;
  /** Device scale applied to the minimum. Defaults to 1. */
  scale?: number;
}

export function touchTargetSize(options: TouchTargetOptions = {}): number {
  return (options.minimum ?? MIN_TOUCH_TARGET) * (options.scale ?? 1);
}

/** Whether a control is at least the platform touch-target size. */
export function meetsTouchTarget(
  bounds: Rect,
  options: TouchTargetOptions = {},
): boolean {
  const minimum = touchTargetSize(options);
  return bounds.width >= minimum && bounds.height >= minimum;
}

/**
 * Expand a control's hit area to the minimum touch target without moving its
 * centre. Scene coordinates are centred, matching the layout engine.
 */
export function ensureTouchTarget(
  bounds: Rect,
  options: TouchTargetOptions = {},
): Rect {
  const minimum = touchTargetSize(options);
  const width = Math.max(bounds.width, minimum);
  const height = Math.max(bounds.height, minimum);
  return {
    x: bounds.x - (width - bounds.width) / 2,
    y: bounds.y - (height - bounds.height) / 2,
    width,
    height,
  };
}

export type A11yRule =
  | 'label'
  | 'touch-target'
  | 'value'
  | 'heading-level'
  | 'action'
  | 'state';

export interface A11yIssue {
  rule: A11yRule;
  message: string;
  role: SemanticsRole;
  /** Index in the audited array. */
  index: number;
}

export interface AuditOptions extends TouchTargetOptions {
  /** Supply bounds when they live outside the semantics node. */
  bounds?(node: Semantics): Rect | undefined;
  /** Require `activate` for interactive roles. Defaults to true. */
  requireAction?: boolean;
}

const ACTION_ROLES = new Set<SemanticsRole>([
  'button',
  'link',
  'menuitem',
  'tab',
  'checkbox',
  'radio',
  'switch',
]);

/**
 * Static accessibility gate for the semantics tree. This covers the checks an
 * axe/Accessibility Scanner pass can make without a running screen reader:
 * labels, roles that need state/value, heading levels, actions and target
 * size. Apps run it in tests or a dev screen and fail the build on issues.
 */
export function auditSemantics(
  nodes: readonly Semantics[],
  options: AuditOptions = {},
): A11yIssue[] {
  const issues: A11yIssue[] = [];
  const requireAction = options.requireAction !== false;

  nodes.forEach((node, index) => {
    const add = (rule: A11yRule, message: string) =>
      issues.push({ rule, message, role: node.role, index });

    if (!node.label || !node.label.trim()) {
      add('label', `${node.role} is missing an accessible label`);
    }
    if (node.description !== undefined && !node.description.trim()) {
      add('label', `${node.role} has an empty description`);
    }
    if (node.role === 'heading') {
      if (node.level === undefined || node.level < 1 || node.level > 6) {
        add('heading-level', 'heading level must be between 1 and 6');
      }
    }
    if (
      node.role === 'switch' ||
      node.role === 'checkbox' ||
      node.role === 'radio'
    ) {
      if (node.checked === undefined) {
        add('state', `${node.role} must expose its checked state`);
      }
    }
    if (node.role === 'slider' || node.role === 'progressbar') {
      if (node.now === undefined && node.value === undefined) {
        add('value', `${node.role} must expose a current value`);
      }
      if (
        node.now !== undefined &&
        ((node.min !== undefined && node.now < node.min) ||
          (node.max !== undefined && node.now > node.max))
      ) {
        add('value', `${node.role} value is outside its min/max range`);
      }
    }
    if (
      requireAction &&
      ACTION_ROLES.has(node.role) &&
      !node.disabled &&
      !node.activate
    ) {
      add('action', `${node.role} has no activate action`);
    }

    const bounds = options.bounds?.(node) ?? node.bounds?.();
    if (bounds && !meetsTouchTarget(bounds, options)) {
      add(
        'touch-target',
        `${node.role} is ${Math.round(bounds.width)}x${Math.round(
          bounds.height,
        )}, expected at least ${touchTargetSize(options)}`,
      );
    }
  });

  return issues;
}

export interface ReadingOrderItem {
  bounds?: () => Rect;
  semantics?: Semantics;
}

/**
 * Sort controls into visual reading order: rows top-to-bottom, then
 * left-to-right (reversed for RTL). A small row tolerance keeps controls that
 * are visually aligned on the same row together.
 */
export function readingOrder<T extends ReadingOrderItem>(
  items: readonly T[],
  direction: 'ltr' | 'rtl' = 'ltr',
  rowTolerance = 8,
): T[] {
  const boundsOf = (item: T): Rect =>
    item.bounds?.() ??
    item.semantics?.bounds?.() ?? { x: 0, y: 0, width: 0, height: 0 };
  return [...items].sort((a, b) => {
    const first = boundsOf(a);
    const second = boundsOf(b);
    if (Math.abs(first.y - second.y) > rowTolerance) {
      return first.y - second.y;
    }
    return direction === 'rtl' ? second.x - first.x : first.x - second.x;
  });
}
