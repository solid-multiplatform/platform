import * as v from 'vitest';
import * as lng from '@solid-multiplatform/platform';
import {
  KeyboardAvoidingView,
  SafeArea,
} from '@solid-multiplatform/platform/primitives';
import {
  ThemeProvider,
  darkTheme,
  lightTheme,
  revealAboveKeyboard,
  setCapabilities,
  setColorScheme,
  supports,
  useKeyboard,
  useTheme,
  createForm,
  keyboardAwareBounds,
} from '@solid-multiplatform/platform';
import { updateViewport, viewport, zeroInsets } from '../src/sdk/viewport.js';
import { scrollAxis } from '../src/sdk/scroll.js';
import { renderer, waitForUpdate } from './setup.js';

const reset = () =>
  updateViewport({
    width: 800,
    height: 600,
    scale: 1,
    safeArea: zeroInsets,
    keyboardInset: 0,
    reducedMotion: false,
  });

v.beforeEach(() => {
  reset();
  lng.resetCapabilities();
  setColorScheme('light');
});

v.describe('viewport insets', () => {
  v.it(
    'publishes system bars, cutout and IME separately and keeps aliases',
    () => {
      updateViewport({
        width: 800,
        height: 600,
        scale: 1,
        safeArea: { top: 24, right: 0, bottom: 16, left: 0 },
        keyboardInset: 280,
        reducedMotion: false,
        systemBars: { top: 24, right: 0, bottom: 16, left: 0 },
        displayCutout: { top: 6, right: 0, bottom: 0, left: 0 },
        ime: { top: 0, right: 0, bottom: 280, left: 0 },
      });
      const current = viewport();
      v.expect(current.insets.systemBars.top).toBe(24);
      v.expect(current.insets.displayCutout.top).toBe(6);
      v.expect(current.insets.ime.bottom).toBe(280);
      v.expect(current.keyboardInset).toBe(280);
      v.expect(current.safeArea.bottom).toBe(16);
    },
  );

  v.it('derives the IME inset from keyboardInset when a host omits it', () => {
    updateViewport({
      width: 800,
      height: 600,
      scale: 1,
      safeArea: zeroInsets,
      keyboardInset: 120,
      reducedMotion: false,
    });
    v.expect(viewport().insets.ime.bottom).toBe(120);
  });
});

v.describe('KeyboardAvoidingView', () => {
  v.it('shrinks its height for the keyboard', async () => {
    updateViewport({
      width: 800,
      height: 600,
      scale: 1,
      safeArea: zeroInsets,
      keyboardInset: 250,
      reducedMotion: false,
    });
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <KeyboardAvoidingView
        behavior="height"
        ref={(n) => (node = n as lng.ElementNode)}
      />
    ));
    await waitForUpdate();
    v.expect(node.height).toBe(350);
    dispose();
  });

  v.it('relaxes when the host reports the keyboard hidden', async () => {
    updateViewport({
      width: 800,
      height: 600,
      scale: 1,
      safeArea: zeroInsets,
      keyboardInset: 250,
      reducedMotion: false,
    });
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <KeyboardAvoidingView
        behavior="height"
        ref={(n) => (node = n as lng.ElementNode)}
      />
    ));
    await waitForUpdate();
    v.expect(node.height).toBe(350);
    // The field blurred, the host dismissed the IME, and the inset the host
    // publishes went back to zero: the container must give the space back,
    // or the form stays pushed up over an empty band.
    updateViewport({
      width: 800,
      height: 600,
      scale: 1,
      safeArea: zeroInsets,
      keyboardInset: 0,
      reducedMotion: false,
    });
    await waitForUpdate();
    v.expect(node.height).toBe(600);
    dispose();
  });

  v.it('moves itself up for position behaviour', async () => {
    updateViewport({
      width: 800,
      height: 600,
      scale: 1,
      safeArea: zeroInsets,
      keyboardInset: 250,
      reducedMotion: false,
    });
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <KeyboardAvoidingView
        behavior="position"
        ref={(n) => (node = n as lng.ElementNode)}
      />
    ));
    await waitForUpdate();
    v.expect(node.y).toBe(-250);
    v.expect(node.height).toBe(600);
    dispose();
  });

  v.it('honours keyboardVerticalOffset and can be disabled', async () => {
    updateViewport({
      width: 800,
      height: 600,
      scale: 1,
      safeArea: zeroInsets,
      keyboardInset: 250,
      reducedMotion: false,
    });
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <KeyboardAvoidingView
        behavior="height"
        keyboardVerticalOffset={50}
        ref={(n) => (node = n as lng.ElementNode)}
      />
    ));
    await waitForUpdate();
    v.expect(node.height).toBe(400);
    dispose();

    let disabled!: lng.ElementNode;
    const disposeDisabled = renderer.render(() => (
      <KeyboardAvoidingView
        behavior="height"
        enabled={false}
        ref={(n) => (disabled = n as lng.ElementNode)}
      />
    ));
    await waitForUpdate();
    v.expect(disabled.height).toBe(600);
    disposeDisabled();
  });
});

v.describe('SafeArea', () => {
  v.it('insets every edge by default', async () => {
    updateViewport({
      width: 800,
      height: 600,
      scale: 1,
      safeArea: { top: 30, right: 5, bottom: 20, left: 10 },
      keyboardInset: 0,
      reducedMotion: false,
    });
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <SafeArea ref={(n) => (node = n as lng.ElementNode)} />
    ));
    await waitForUpdate();
    // Padding keeps the box at the window edge and insets its content: the
    // children start after the status bar and the notch, not under them.
    v.expect(node.x).toBe(0);
    v.expect(node.y).toBe(0);
    v.expect(node.width).toBe(800);
    v.expect(node.height).toBe(600);
    const content = node.children[0] as lng.ElementNode;
    v.expect([content.x, content.y, content.width, content.height]).toEqual([
      10, 30, 785, 550,
    ]);
    dispose();
  });

  v.it('supports a subset of edges and margin mode', async () => {
    updateViewport({
      width: 800,
      height: 600,
      scale: 1,
      safeArea: { top: 30, right: 5, bottom: 20, left: 10 },
      keyboardInset: 0,
      reducedMotion: false,
    });
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <SafeArea
        edges={['top']}
        mode="margin"
        ref={(n) => (node = n as lng.ElementNode)}
      />
    ));
    await waitForUpdate();
    v.expect(node.x).toBe(0);
    v.expect(node.y).toBe(30);
    v.expect(node.width).toBe(800);
    v.expect(node.height).toBe(570);
    dispose();
  });
});

v.describe('keyboard and theme helpers', () => {
  v.it('reveals a field above the keyboard through the scroll axis', () => {
    updateViewport({
      width: 800,
      height: 600,
      scale: 1,
      safeArea: zeroInsets,
      keyboardInset: 200,
      reducedMotion: false,
    });
    const scroll = scrollAxis();
    scroll.layout(2000, 600);
    v.expect(useKeyboard().height()).toBe(200);
    revealAboveKeyboard(scroll, 700, 760, 600);
    v.expect(scroll.offset()).toBe(360);
  });

  v.it(
    'follows the system colour scheme and allows a provider override',
    async () => {
      setColorScheme('dark');
      v.expect(useTheme().colorScheme).toBe('dark');
      v.expect(useTheme().colors.background).toBe(darkTheme.colors.background);

      let theme!: lng.Theme;
      const custom = { ...lightTheme, colorScheme: 'dark' as const };
      const dispose = renderer.render(() => (
        <ThemeProvider theme={custom}>
          <CustomThemeProbe onTheme={(value) => (theme = value)} />
        </ThemeProvider>
      ));
      await waitForUpdate();
      v.expect(theme).toBe(custom);
      dispose();
    },
  );

  v.it('reports target capabilities', () => {
    setCapabilities('android-tv');
    v.expect(supports('remote')).toBe(true);
    v.expect(supports('mouse')).toBe(false);
    setCapabilities('desktop');
    v.expect(supports('mouse')).toBe(true);
    v.expect(lng.hasKeyboard()).toBe(true);
    lng.resetCapabilities();
  });
});

function CustomThemeProbe(props: { onTheme(theme: lng.Theme): void }) {
  props.onTheme(useTheme());
  return null;
}

v.describe('forms', () => {
  v.it('validates touched fields and blocks invalid submission', async () => {
    const form = createForm({
      initial: { email: '', password: '' },
      validate: (values) => ({
        email: values.email.includes('@') ? undefined : 'Enter a valid email',
        password: values.password.length >= 8 ? undefined : 'Use 8 characters',
      }),
    });
    const email = form.field('email');
    v.expect(email.error()).toBeUndefined();
    email.set('nope');
    email.blur();
    v.expect(email.error()).toBe('Enter a valid email');
    v.expect(await form.submit(() => v.expect.fail('must not submit'))).toBe(
      false,
    );
    email.set('a@b.co');
    form.field('password').set('12345678');
    let submitted: lng.FormValues | undefined;
    v.expect(
      await form.submit((values) => {
        submitted = values;
      }),
    ).toBe(true);
    v.expect(submitted).toEqual({ email: 'a@b.co', password: '12345678' });
    v.expect(form.errors()).toEqual({});
  });

  v.it(
    'keeps the last error message after a failed submit until corrected',
    async () => {
      const form = createForm({
        initial: { name: '' },
        validate: (values) => ({
          name: values.name ? undefined : 'Name is required',
        }),
      });
      v.expect(await form.submit(() => {})).toBe(false);
      v.expect(form.field('name').error()).toBe('Name is required');
      form.setValue('name', 'Ada');
      v.expect(form.field('name').error()).toBeUndefined();
    },
  );
});

v.describe('keyboardAwareBounds', () => {
  v.it('moves a field above the keyboard and leaves it alone otherwise', () => {
    updateViewport({
      width: 800,
      height: 600,
      scale: 1,
      safeArea: zeroInsets,
      keyboardInset: 200,
      reducedMotion: false,
    });
    const low = keyboardAwareBounds(() => ({
      x: 16,
      y: 480,
      width: 360,
      height: 56,
    }));
    v.expect(low()).toEqual({ x: 16, y: 332, width: 360, height: 56 });
    const high = keyboardAwareBounds(() => ({
      x: 16,
      y: 100,
      width: 360,
      height: 56,
    }));
    v.expect(high()).toEqual({ x: 16, y: 100, width: 360, height: 56 });
    const ignored = keyboardAwareBounds(
      () => ({ x: 16, y: 480, width: 360, height: 56 }),
      { avoid: false },
    );
    v.expect(ignored()).toEqual({ x: 16, y: 480, width: 360, height: 56 });
  });
});
