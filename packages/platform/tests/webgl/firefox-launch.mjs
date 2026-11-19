/**
 * The one Firefox launch used by every browser test in this repository:
 * `vitest.webgl.config.ts` (WebGL and Canvas in Firefox) and
 * `apps/showcase/tests/showcase.e2e.mjs` (the app-level walk).
 *
 * A Linux runner has no GPU. Headless Firefox creates a WebGL context through
 * Mesa's llvmpipe when the software path is allowed; the same browser headed
 * under Xvfb does not (it reports FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS),
 * so both callers stay headless. Keep them on this object: when they drifted
 * apart the showcase failed while the WebGL suite passed.
 */
export function firefoxLaunch() {
  return {
    headless: true,
    firefoxUserPrefs: {
      'webgl.disabled': false,
      'webgl.force-enabled': true,
      'webgl.out-of-process': false,
      'gfx.webrender.software': true,
      'layers.acceleration.disabled': true,
    },
    env: {
      ...process.env,
      LIBGL_ALWAYS_SOFTWARE: '1',
      // Pick Mesa's software rasteriser by name as well: a runner with no
      // GPU otherwise reports FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS.
      GALLIUM_DRIVER: 'llvmpipe',
      MESA_LOADER_DRIVER_OVERRIDE: 'llvmpipe',
      MOZ_ENABLE_WAYLAND: '0',
    },
  };
}
