// A canvas keeps its first context attributes for life. Probe with renderer settings.
export const contextAttributes = Object.freeze({
  alpha: true, antialias: false, depth: false, stencil: false,
  desynchronized: false, powerPreference: 'high-performance',
  premultipliedAlpha: true, preserveDrawingBuffer: false
});

export function createNativeContext(canvas, options = {}) {
  const attributes = { ...contextAttributes, ...options };
  const modern = canvas.getContext('webgl2', attributes);
  if (modern) return { gl: modern, webgl2: true };
  const legacy = canvas.getContext('webgl', attributes);
  if (legacy) return { gl: legacy, webgl2: false };
  throw new Error('This device has no usable native WebGL context');
}
