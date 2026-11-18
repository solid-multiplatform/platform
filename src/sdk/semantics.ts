export type SemanticsRole =
  | 'button'
  | 'heading'
  | 'status'
  | 'switch'
  | 'slider'
  | 'group'
  | 'link'
  | 'checkbox'
  | 'radio'
  | 'textbox'
  | 'searchbox'
  | 'dialog'
  | 'alertdialog'
  | 'list'
  | 'listitem'
  | 'menu'
  | 'menuitem'
  | 'tab'
  | 'tabpanel'
  | 'progressbar'
  | 'img'
  | 'separator'
  | 'navigation'
  | 'main';

export interface Semantics {
  bounds?: () => { x: number; y: number; width: number; height: number };
  label: string;
  role: SemanticsRole;
  disabled?: boolean;
  value?: string;
  checked?: boolean;
  /** `aria-selected`, used by tabs, options and rows. */
  selected?: boolean;
  /** `aria-expanded`, used by disclosure buttons and menus. */
  expanded?: boolean;
  /** Heading level, 1–6. */
  level?: number;
  /** Secondary description for screen readers. */
  description?: string;
  min?: number;
  max?: number;
  now?: number;
  activate?(): void;
  focus?(): void;
}

/**
 * Browser accessibility nodes for canvas content. Real editors have their own
 * native semantics. The hidden tree mirrors the scene so screen readers can
 * enumerate roles, labels, values and actions without a platform-specific API.
 */
export function browserSemantics(root: HTMLElement) {
  const tree = document.createElement('div');
  root.appendChild(tree);
  tree.style.cssText =
    'position:absolute;top:0;left:0;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
  return {
    register(initial: Semantics) {
      const el = document.createElement(
        initial.role === 'button' ? 'button' : 'div',
      );
      if (el instanceof HTMLButtonElement) el.type = 'button';
      let node = initial;
      function update(next: Semantics) {
        node = next;
        el.setAttribute('role', node.role);
        el.setAttribute('aria-label', node.label);
        el.setAttribute('aria-disabled', String(!!node.disabled));
        el.tabIndex = !node.disabled && node.activate ? 0 : -1;
        if (node.checked !== undefined)
          el.setAttribute('aria-checked', String(node.checked));
        else el.removeAttribute('aria-checked');
        if (node.selected !== undefined)
          el.setAttribute('aria-selected', String(node.selected));
        else el.removeAttribute('aria-selected');
        if (node.expanded !== undefined)
          el.setAttribute('aria-expanded', String(node.expanded));
        else el.removeAttribute('aria-expanded');
        if (node.value !== undefined)
          el.setAttribute('aria-valuetext', node.value);
        else el.removeAttribute('aria-valuetext');
        if (node.description !== undefined)
          el.setAttribute('aria-description', node.description);
        else el.removeAttribute('aria-description');
        if (node.role === 'heading')
          el.setAttribute('aria-level', String(node.level ?? 2));
        else el.removeAttribute('aria-level');
        if (node.role === 'dialog' || node.role === 'alertdialog')
          el.setAttribute('aria-modal', 'true');
        else el.removeAttribute('aria-modal');
        if (node.min !== undefined)
          el.setAttribute('aria-valuemin', String(node.min));
        else el.removeAttribute('aria-valuemin');
        if (node.max !== undefined)
          el.setAttribute('aria-valuemax', String(node.max));
        else el.removeAttribute('aria-valuemax');
        if (node.now !== undefined)
          el.setAttribute('aria-valuenow', String(node.now));
        else el.removeAttribute('aria-valuenow');
      }
      el.addEventListener('focus', () => {
        if (!node.disabled) node.focus?.();
      });
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!node.disabled) node.activate?.();
      });
      el.addEventListener('keydown', (e) => e.stopPropagation());
      el.addEventListener('keyup', (e) => e.stopPropagation());
      update(initial);
      tree.appendChild(el);
      return { update, dispose: () => el.remove() };
    },
    dispose: () => tree.remove(),
  };
}
