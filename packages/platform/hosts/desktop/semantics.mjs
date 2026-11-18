import koffi from 'koffi';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditSemantics } from '@solid-multiplatform/platform/a11y';

export function desktopSemantics(window, title) {
  const dir = fileURLToPath(new URL('./accessibility/', import.meta.url));
  const ext = { win32: 'dll', darwin: 'dylib', linux: 'so' }[process.platform];
  const runtime = koffi.load(
    path.join(
      dir,
      process.platform === 'win32' ? 'accesskit.dll' : 'libaccesskit.' + ext,
    ),
  );
  const lib = koffi.load(path.join(dir, 'solid-access.' + ext));
  const ctx = lib.func('void *smp_access_open(void *,const char *)')(
    window.accessHandle(),
    title,
  );
  const item = lib.func(
    'void smp_access_item(void *,uint32_t,const char *,const char *,const char *,double,double,double,double,bool,int)',
  );
  const remove = lib.func('void smp_access_remove(void *,uint32_t)'),
    focus = lib.func('void smp_access_focus(void *,uint32_t)');
  const active = lib.func('void smp_access_active(void *,bool)'),
    bounds = lib.func(
      'void smp_access_bounds(void *,double,double,double,double)',
    );
  const next = lib.func('int smp_access_next(void *, _Out_ uint32_t *)'),
    close = lib.func('void smp_access_close(void *)');
  let last = 1;
  const nodes = new Map();
  function sync(id, n) {
    const b = n.bounds?.() ?? { x: 0, y: 0, width: 0, height: 0 };
    const scale = window.geometry().scale;
    item(
      ctx,
      id,
      n.role,
      n.label,
      n.value ?? '',
      b.x * scale,
      b.y * scale,
      b.width * scale,
      b.height * scale,
      !!n.disabled,
      n.checked === undefined ? -1 : Number(n.checked),
    );
  }
  function resize() {
    const { pixelWidth: w, pixelHeight: h, x, y, scale } = window.geometry();
    bounds(ctx, x * scale, y * scale, w, h);
    for (const [id, n] of nodes) sync(id, n);
  }
  active(ctx, true);
  resize();
  return {
    register(n) {
      const id = ++last;
      nodes.set(id, n);
      sync(id, n);
      return {
        update(value) {
          nodes.set(id, value);
          sync(id, value);
        },
        focus: () => focus(ctx, id),
        dispose() {
          nodes.delete(id);
          remove(ctx, id);
        },
      };
    },
    resize,
    /** Static accessibility audit over the registered AccessKit nodes. */
    audit() {
      return auditSemantics([...nodes.values()], { requireAction: false });
    },
    active: (v) => active(ctx, v),
    dispatch() {
      const result = [0];
      for (let action = next(ctx, result); action; action = next(ctx, result)) {
        const node = nodes.get(result[0]);
        if (node && !node.disabled) {
          node.focus?.();
          if (action === 1) node.activate?.();
        }
      }
    },
    dispose() {
      close(ctx);
      nodes.clear();
      void runtime;
    },
  };
}
