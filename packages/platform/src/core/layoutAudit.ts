import type { ElementNode } from './elementNode.js';
import type { LayoutRect } from '../sdk/layout.js';

/**
 * Layout overflow detection.
 *
 * The framework's layout is immediate and absolute, so a box that does not
 * fit is known the moment it is laid out. This module walks the laid-out tree
 * and reports the two failures a user actually sees:
 *
 * - **cut-off** — a box leaves the viewport or a clipping ancestor, so the
 *   screen/backend draws part of it and hides the rest;
 * - **overflow** — a box leaves the visible surface of its nearest panel (the
 *   view that paints a background, border or radius), so it spills over an
 *   edge that looks like a boundary.
 *
 * Scrollable regions are exempt: content below the fold of a list is there on
 * purpose and can be reached. Animated/transparent nodes are exempt too.
 *
 * The audit is pure and allocation-light: it walks only when asked. In a
 * development build the runtime schedules one pass per layout batch (never a
 * frame loop, never a timer); production builds never call it.
 */

export type LayoutFindingSeverity = 'cut-off' | 'overflow';

export interface LayoutFinding {
  severity: LayoutFindingSeverity;
  /** The offending node. */
  node: ElementNode;
  /** A short description of what the node is, for the warning. */
  label: string;
  /** The node's box in viewport coordinates. */
  rect: LayoutRect;
  /** The box it should have stayed inside. */
  bounds: LayoutRect;
  /** How far it escapes, in logical units. */
  overflow: { top: number; right: number; bottom: number; left: number };
  /** The largest escape, positive. */
  by: number;
  /** Where the primitive that built it lives, when the JSX locator ran. */
  location?: string;
}

export interface LayoutAuditOptions {
  /** Ignore escapes smaller than this many logical units. Defaults to 1. */
  tolerance?: number;
  /**
   * Report boxes that spill out of a panel as well as boxes cut off by the
   * screen. Defaults to true; a build that only wants definite cut-offs can
   * turn it off.
   */
  panels?: boolean;
  /** Called for each finding as it is found. */
  onFinding?(finding: LayoutFinding): void;
}

export interface LayoutAuditResult {
  findings: LayoutFinding[];
  /** The number of nodes visited; useful for tests and build logs. */
  visited: number;
  /** Nodes whose subtrees were skipped as scrollable or hidden. */
  skipped: number;
}

interface Space {
  /** Where local coordinate 0 maps in viewport units. */
  x: number;
  y: number;
  /** The scale applied to local units on the way to the viewport. */
  scale: number;
}

interface Traversal {
  bounds: LayoutRect;
  visual?: LayoutRect;
  scrollable: boolean;
  ignored: boolean;
}

const isElement = (value: unknown): value is ElementNode =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { children?: unknown }).children);

const alphaOf = (node: ElementNode): number => {
  const drawn = (node.lng as { alpha?: unknown } | undefined)?.alpha;
  if (typeof drawn === 'number') return drawn;
  const value = (node as { alpha?: unknown }).alpha;
  return typeof value === 'number' ? value : 1;
};

const hiddenOf = (node: ElementNode): boolean =>
  (node as { hidden?: unknown }).hidden === true;

const scrollOf = (node: ElementNode): string | undefined => {
  const value = (node as { scroll?: unknown }).scroll;
  return typeof value === 'string' ? value : undefined;
};

const property = (node: ElementNode, name: string): unknown =>
  (node as unknown as Record<string, unknown>)[name];

const numberProperty = (node: ElementNode, name: string): number => {
  const value = property(node, name);
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

/** A non-transparent background makes a view a visible surface. */
function paintsSurface(node: ElementNode): boolean {
  const color = property(node, 'color');
  if (typeof color === 'number' && ((color >>> 0) & 0xff) !== 0) return true;
  if (node.lng && typeof node.lng === 'object') {
    const lng = node.lng as {
      color?: number;
      shader?: { props?: Record<string, unknown> } | null;
    };
    if (typeof lng.color === 'number' && ((lng.color >>> 0) & 0xff) !== 0)
      return true;
    if (lng.shader?.props) {
      const props = lng.shader.props;
      if (props.colors !== undefined || props.color !== undefined) return true;
      if (props['border-w'] !== undefined) return true;
    }
  }
  const border = property(node, 'border');
  if (border !== undefined && border !== null) return true;
  const radius = property(node, 'borderRadius');
  if (typeof radius === 'number' && radius > 0) return true;
  if (
    Array.isArray(radius) &&
    radius.some((r) => typeof r === 'number' && r > 0)
  )
    return true;
  return false;
}

/**
 * The text content a node carries, if the node is a text node.
 *
 * `ElementNode.getText` is defined on every node and reads `children[0].text`,
 * so calling it on a container whose first child happens to be a heading
 * returns that heading's text — and the walk would then treat the whole
 * panel as a text leaf and never audit inside it. A dialog whose box starts
 * with a title is exactly the shape that must be audited most, so only a real
 * text node is a leaf here.
 */
function textOf(node: ElementNode): string | undefined {
  if ((node as { _type?: unknown })._type !== 'textNode') return undefined;
  const getText = (node as { getText?: () => string }).getText;
  if (typeof getText !== 'function') return undefined;
  return getText.call(node);
}

function labelOf(node: ElementNode): string {
  const trimmed = (value: unknown, max = 40): string | undefined => {
    if (typeof value !== 'string' || value.length === 0) return undefined;
    return value.length > max ? value.slice(0, max - 1) + '…' : value;
  };
  const name = trimmed(property(node, 'componentName'));
  const id = trimmed(property(node, 'id'));
  const aria = trimmed(property(node, 'ariaLabel'));
  const role = trimmed(property(node, 'role'));
  const text = node._type === 'textNode' ? trimmed(textOf(node)) : undefined;
  return [name, id, aria, role !== 'none' ? role : undefined, text]
    .filter((part): part is string => part !== undefined)
    .join(' ');
}

function intersects(a: LayoutRect, b: LayoutRect, tolerance = 0): boolean {
  return (
    a.x < b.x + b.width - tolerance &&
    a.x + a.width > b.x + tolerance &&
    a.y < b.y + b.height - tolerance &&
    a.y + a.height > b.y + tolerance
  );
}

function intersection(a: LayoutRect, b: LayoutRect): LayoutRect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

function overflowOf(rect: LayoutRect, bounds: LayoutRect) {
  const top = bounds.y - rect.y;
  const right = rect.x + rect.width - (bounds.x + bounds.width);
  const bottom = rect.y + rect.height - (bounds.y + bounds.height);
  const left = bounds.x - rect.x;
  return {
    top: Math.max(0, Math.round(top)),
    right: Math.max(0, Math.round(right)),
    bottom: Math.max(0, Math.round(bottom)),
    left: Math.max(0, Math.round(left)),
  };
}

const largest = (value: ReturnType<typeof overflowOf>): number =>
  Math.max(value.top, value.right, value.bottom, value.left);

function emptyRect(): LayoutRect {
  return { x: 0, y: 0, width: 0, height: 0 };
}

/**
 * Audit a laid-out tree under `bounds` (usually the viewport). Returns every
 * box that escapes a clipping context, and optionally every box that escapes
 * the visible panel it belongs to.
 */
export function auditLayout(
  root: ElementNode,
  bounds: LayoutRect,
  options: LayoutAuditOptions = {},
): LayoutAuditResult {
  const tolerance = options.tolerance ?? 1;
  const panels = options.panels !== false;
  const findings: LayoutFinding[] = [];
  let visited = 0;
  let skipped = 0;

  const report = (
    severity: LayoutFindingSeverity,
    node: ElementNode,
    rect: LayoutRect,
    against: LayoutRect,
  ) => {
    const overflow = overflowOf(rect, against);
    const by = largest(overflow);
    if (by <= tolerance) return;
    const finding: LayoutFinding = {
      severity,
      node,
      label: labelOf(node),
      rect,
      bounds: against,
      overflow,
      by,
      location:
        typeof property(node, 'componentLocation') === 'string'
          ? (property(node, 'componentLocation') as string)
          : undefined,
    };
    findings.push(finding);
    options.onFinding?.(finding);
  };

  const walk = (node: ElementNode, parent: Space, context: Traversal): void => {
    if (!isElement(node)) return;
    if (node.destroyed === true) return;
    if (context.ignored) return;
    if (
      node.data &&
      (node.data as { layoutAuditIgnore?: unknown }).layoutAuditIgnore === true
    )
      return;
    if (alphaOf(node) === 0 || hiddenOf(node)) {
      skipped++;
      return;
    }

    visited++;
    const width = node.width || 0;
    const height = node.height || 0;
    const ownScale = numberProperty(node, 'scale') || 1;
    const lng = node.lng as { mountX?: number; mountY?: number } | undefined;
    const mountX = lng?.mountX ?? 0;
    const mountY = lng?.mountY ?? 0;
    const localX = (node.x || 0) - width * mountX;
    const localY = (node.y || 0) - height * mountY;
    const centreX = parent.x + (localX + width / 2) * parent.scale;
    const centreY = parent.y + (localY + height / 2) * parent.scale;
    const scale = parent.scale * ownScale;
    const rect: LayoutRect = {
      x: centreX - (width * scale) / 2,
      y: centreY - (height * scale) / 2,
      width: width * scale,
      height: height * scale,
    };
    const childSpace: Space = {
      x: centreX - (width / 2) * scale,
      y: centreY - (height / 2) * scale,
      scale,
    };

    // Text is a leaf. An empty box is a layout placeholder, not UI.
    const text = textOf(node);
    if (width > 0 && height > 0) {
      if (largest(overflowOf(rect, context.bounds)) > tolerance) {
        report('cut-off', node, rect, context.bounds);
      } else if (
        panels &&
        context.visual !== undefined &&
        largest(overflowOf(rect, context.visual)) > tolerance
      ) {
        report('overflow', node, rect, context.visual);
      }
    } else if (
      text !== undefined &&
      text.length > 0 &&
      context.visual !== undefined
    ) {
      // A text with no measured box can still be audited once the backend
      // reports one; a zero box tells us nothing, so leave it alone.
    }

    if (text !== undefined) return;

    const scroll = scrollOf(node);
    if (scroll !== undefined && scroll !== 'none') {
      skipped++;
      return;
    }

    let childBounds = context.bounds;
    if (node.clipping) {
      const clipping = node.clipping;
      if (Array.isArray(clipping)) {
        const [x = 0, y = 0, w = width, h = height] = clipping;
        childBounds = intersection(childBounds, {
          x: childSpace.x + x * scale,
          y: childSpace.y + y * scale,
          width: w * scale,
          height: h * scale,
        });
      } else {
        childBounds = intersection(childBounds, rect);
      }
    }

    // A panel is a surface a person reads as a boundary. A border or radius
    // alone is enough for a chip; a full-colour background is the usual case.
    const visual = paintsSurface(node) ? rect : context.visual;
    const ignored =
      (node.data as { layoutAuditIgnore?: unknown } | undefined)
        ?.layoutAuditIgnore === true;

    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      walk(children[i] as ElementNode, childSpace, {
        bounds: childBounds,
        visual,
        scrollable: false,
        ignored,
      });
    }
  };

  const children = root.children;
  for (let i = 0; i < children.length; i++) {
    walk(
      children[i] as ElementNode,
      { x: 0, y: 0, scale: 1 },
      {
        bounds,
        visual: undefined,
        scrollable: false,
        ignored: false,
      },
    );
  }

  return { findings, visited, skipped };
}

/**
 * The one-line warning a development build prints. Kept here so the runtime
 * and a build-time harness describe a finding the same way.
 */
export function formatLayoutFinding(finding: LayoutFinding): string {
  const rect = finding.rect;
  const edge = Object.entries(finding.overflow)
    .filter(([, value]) => value > 0)
    .map(([side, value]) => `${value} ${side}`)
    .join(', ');
  const what = finding.label === '' ? 'view' : finding.label;
  const where = finding.location ? ` (${finding.location})` : '';
  return (
    `[layout] ${what}${where} is ${finding.severity === 'cut-off' ? 'cut off' : 'overflowing'}` +
    ` by ${edge}: box ${Math.round(rect.x)},${Math.round(rect.y)} ` +
    `${Math.round(rect.width)}×${Math.round(rect.height)}`
  );
}

// ---------------------------------------------------------------------------
// Development integration
// ---------------------------------------------------------------------------

interface AuditRuntime {
  root: ElementNode;
  bounds: LayoutRect;
  tolerance: number;
  panels: boolean;
  onFindings?: (findings: LayoutFinding[]) => void;
}

let pending: AuditRuntime | undefined;
let scheduled = false;
let lastSignature = '';
let warned = 0;

/**
 * Schedule one audit after the current layout batch. Coalesced: many nodes
 * changing in one pass produce a single walk on the next microtask. Never a
 * timer and never a frame loop, so an idle scene pays nothing.
 */
export function scheduleLayoutAudit(runtime: AuditRuntime): void {
  pending = runtime;
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const job = pending;
    pending = undefined;
    if (job === undefined) return;
    const result = auditLayout(job.root, job.bounds, {
      tolerance: job.tolerance,
      panels: job.panels,
    });
    if (result.findings.length === 0) {
      lastSignature = '';
      warned = 0;
      return;
    }
    // The same screen laid out again should not repeat the same warning. A
    // changed finding set is news; an unchanged one has been reported.
    const signature = result.findings
      .map(
        (finding) =>
          `${finding.severity}:${finding.label}:${finding.by}:${Math.round(finding.rect.x)},${Math.round(finding.rect.y)}`,
      )
      .sort()
      .join('|');
    if (signature === lastSignature) return;
    lastSignature = signature;
    if (job.onFindings !== undefined) {
      job.onFindings(result.findings);
      return;
    }
    // A broken screen can produce hundreds of rows; the first few identify
    // the container, the total says how widespread it is.
    for (const finding of result.findings.slice(0, 6)) {
      console.warn(formatLayoutFinding(finding));
    }
    if (result.findings.length > 6) {
      console.warn(
        `[layout] …and ${result.findings.length - 6} more overflowing boxes`,
      );
    }
    warned++;
    if (warned === 1) {
      console.warn(
        '[layout] Layout audit: set Config.layoutAudit = false to silence, or fix the boxes above. ' +
          'Content inside a scroll container is exempt.',
      );
    }
  });
}

/** Clear the audit's de-duplication state (a new screen, a test). */
export function resetLayoutAudit(): void {
  pending = undefined;
  scheduled = false;
  lastSignature = '';
  warned = 0;
}
