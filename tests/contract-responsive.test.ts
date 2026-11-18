import * as v from 'vitest';
import {
  breakpoint,
  breakpointFor,
  defaultBreakpoints,
  resolveResponsive,
} from '../src/sdk/responsive.js';
import { updateViewport, zeroInsets } from '../src/sdk/viewport.js';

const size = (width: number) =>
  updateViewport({
    width,
    height: 900,
    scale: 1,
    safeArea: zeroInsets,
    reducedMotion: false,
  });

v.describe('responsive breakpoints', () => {
  v.it('maps widths to Material window classes', () => {
    v.expect(defaultBreakpoints).toEqual({
      compact: 0,
      medium: 600,
      expanded: 960,
    });
    v.expect(breakpointFor(320)).toBe('compact');
    v.expect(breakpointFor(599)).toBe('compact');
    v.expect(breakpointFor(600)).toBe('medium');
    v.expect(breakpointFor(959)).toBe('medium');
    v.expect(breakpointFor(960)).toBe('expanded');
  });

  v.it('is reactive to viewport updates', () => {
    size(400);
    v.expect(breakpoint()).toBe('compact');
    size(800);
    v.expect(breakpoint()).toBe('medium');
    size(1280);
    v.expect(breakpoint()).toBe('expanded');
  });

  v.it('accepts custom breakpoints', () => {
    const custom = { compact: 0, medium: 500, expanded: 1000 };
    v.expect(breakpointFor(700, custom)).toBe('medium');
    v.expect(breakpointFor(1000, custom)).toBe('expanded');
  });

  v.it('resolves the nearest smaller responsive value', () => {
    const value = { compact: 1, expanded: 3 };
    v.expect(resolveResponsive(value, 'compact')).toBe(1);
    v.expect(resolveResponsive(value, 'medium')).toBe(1);
    v.expect(resolveResponsive(value, 'expanded')).toBe(3);
    v.expect(resolveResponsive({ compact: 1, medium: 2 }, 'expanded')).toBe(2);
    v.expect(resolveResponsive('plain', 'expanded')).toBe('plain');
  });
});
