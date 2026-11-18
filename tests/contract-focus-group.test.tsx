import * as v from 'vitest';
import * as lng from '@solid-multiplatform/platform';
import { FocusGroup } from '@solid-multiplatform/platform/primitives';
import { flush, mount } from './contract-focus-helpers.js';

const setup = async (wrap?: boolean) => {
  let a!: lng.ElementNode;
  let b!: lng.ElementNode;
  let c!: lng.ElementNode;
  const mounted = await mount(() => (
    <FocusGroup items={() => [a, b, c]} wrap={wrap} width={400} height={300}>
      <view ref={a} width={100} height={40} onEnter={() => {}} />
      <view ref={b} width={100} height={40} onEnter={() => {}} />
      <view ref={c} width={100} height={40} onEnter={() => {}} />
    </FocusGroup>
  ));
  await flush();
  return { ...mounted, a, b, c };
};

v.describe('FocusGroup', () => {
  v.it('moves through fields with Tab and wraps at the end', async () => {
    const { target, dispose, a, b, c } = await setup();
    a.setFocus();
    await flush();
    v.expect(lng.activeElement()).toBe(a);

    const first = target.down('Tab');
    await flush();
    v.expect(lng.activeElement()).toBe(b);
    v.expect(first.preventDefault).toHaveBeenCalled();

    target.down('Tab');
    await flush();
    v.expect(lng.activeElement()).toBe(c);

    target.down('Tab');
    await flush();
    v.expect(lng.activeElement()).toBe(a);

    dispose();
  });

  v.it('moves backwards with Shift+Tab', async () => {
    const { target, dispose, a, b, c } = await setup();
    b.setFocus();
    await flush();

    target.down('Tab', { shiftKey: true });
    await flush();
    v.expect(lng.activeElement()).toBe(a);

    target.down('Tab', { shiftKey: true });
    await flush();
    v.expect(lng.activeElement()).toBe(c);

    target.down('Tab', { shiftKey: true });
    await flush();
    v.expect(lng.activeElement()).toBe(b);
    dispose();
  });

  v.it('does not wrap when wrap is false', async () => {
    const { target, dispose, a, c } = await setup(false);
    c.setFocus();
    await flush();
    const event = target.down('Tab');
    await flush();
    v.expect(lng.activeElement()).toBe(c);
    v.expect(event.preventDefault).not.toHaveBeenCalled();

    a.setFocus();
    await flush();
    target.down('Tab', { shiftKey: true });
    await flush();
    v.expect(lng.activeElement()).toBe(a);
    dispose();
  });

  v.it('leaves other keys to the normal handlers', async () => {
    const { target, dispose, a, b } = await setup();
    let entered = 0;
    // The buttons use no-op onEnter; replace b's handler to observe the key.
    b.onEnter = () => {
      entered++;
    };
    a.setFocus();
    await flush();
    target.down('Enter');
    await flush();
    v.expect(entered).toBe(0);
    v.expect(lng.activeElement()).toBe(a);

    b.setFocus();
    await flush();
    target.down('Enter');
    await flush();
    v.expect(entered).toBe(1);
    dispose();
  });
});
