export interface Semantics {
  bounds?: () => { x: number; y: number; width: number; height: number };
  label: string;
  role: 'button' | 'heading' | 'status' | 'switch' | 'slider' | 'group';
  disabled?: boolean;
  value?: string;
  checked?: boolean;
  activate?(): void;
  focus?(): void;
}
/** Browser accessibility nodes for canvas content. Real editors have their own native semantics. */
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
        if (node.value !== undefined)
          el.setAttribute('aria-valuetext', node.value);
        else el.removeAttribute('aria-valuetext');
        if (node.role === 'heading') el.setAttribute('aria-level', '1');
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
