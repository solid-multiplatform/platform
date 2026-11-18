import * as v from 'vitest';
import { createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import { Icon, Svg } from '@solid-multiplatform/platform/primitives';
import {
  clearIconRegistry,
  getIcon,
  iconDataUrl,
  iconSvg,
  registerIcon,
  registerIcons,
  svgDataUrl,
} from '../src/sdk/svg.js';
import { renderer, waitForUpdate } from './setup.js';

const decode = (url: string) =>
  decodeURIComponent(url.slice(url.indexOf(',') + 1));

const allSrc = (node: unknown, found: string[] = []): string[] => {
  if (!lng.isINode(node)) return found;
  if (lng.isElementNode(node)) {
    const src = (node as unknown as { src?: unknown }).src;
    if (typeof src === 'string' && src.length) found.push(src);
  }
  for (const child of node.children) allSrc(child, found);
  return found;
};

const findSrc = (fragment: string): string | undefined =>
  allSrc(renderer.rootNode).find((src) => decode(src).includes(fragment));

v.describe('SVG helpers', () => {
  v.afterEach(() => clearIconRegistry());

  v.it('encodes a document as a data URL', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>';
    const url = svgDataUrl(svg);
    v.expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    v.expect(decode(url)).toBe(svg);
  });

  v.it('builds filled and stroked path icons', () => {
    const definition = {
      path: 'M2 2h20v20H2z',
      viewBox: '0 0 24 24',
      fillRule: 'evenodd' as const,
    };
    const filled = iconSvg(definition, { color: 0xff000080, width: 48 });
    v.expect(filled).toContain('viewBox="0 0 24 24"');
    v.expect(filled).toContain('width="48"');
    v.expect(filled).toContain('fill="#ff0000"');
    v.expect(filled).toContain('fill-opacity="0.5019607843137255"');
    v.expect(filled).toContain('fill-rule="evenodd"');

    const stroked = iconSvg(definition, {
      stroke: true,
      strokeWidth: 3,
      color: 0x00ff00ff,
    });
    v.expect(stroked).toContain('fill="none"');
    v.expect(stroked).toContain('stroke="#00ff00"');
    v.expect(stroked).toContain('stroke-width="3"');
  });

  v.it('registers named icons and rejects unknown names', () => {
    registerIcon('check', { path: 'M4 12l5 5L20 6' });
    registerIcons({ close: { path: 'M6 6l12 12M18 6L6 18' } });
    v.expect(getIcon('check')?.path).toBe('M4 12l5 5L20 6');
    v.expect(getIcon('close')?.path).toBe('M6 6l12 12M18 6L6 18');
    v.expect(iconDataUrl('check', { color: 0xffffffff })).toContain(
      'data:image/svg+xml',
    );
    v.expect(() => iconDataUrl('missing')).toThrowError(/Unknown icon/);
  });
});

v.describe('Svg and Icon', () => {
  v.afterEach(() => clearIconRegistry());

  v.it('renders an SVG source as an image texture', async () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#abcdef"/></svg>';
    const dispose = renderer.render(() => (
      <view width={100} height={100}>
        <Svg source={source} width={32} height={32} />
      </view>
    ));
    await waitForUpdate();
    const src = findSrc('<rect width="32" height="32"')!;
    v.expect(src.startsWith('data:image/svg+xml')).toBe(true);
    dispose();
  });

  v.it('renders a registered icon and updates its colour', async () => {
    registerIcon('dot', { path: 'M3 3h18v18H3z' });
    const [color, setColor] = createSignal(0xff0000ff);
    const dispose = renderer.render(() => (
      <view width={100} height={100}>
        <Icon name="dot" size={32} color={color()} />
      </view>
    ));
    await waitForUpdate();
    const matches = (fragment: string) =>
      allSrc(renderer.rootNode).filter((src) => decode(src).includes(fragment));
    const first = matches('M3 3h18v18H3z').at(-1)!;
    v.expect(decode(first)).toContain('fill="#ff0000"');
    v.expect(decode(first)).toContain('width="32"');

    setColor(0x00ff00ff);
    await waitForUpdate();
    const second = matches('M3 3h18v18H3z').at(-1)!;
    v.expect(decode(second)).toContain('fill="#00ff00"');
    dispose();
  });
});
