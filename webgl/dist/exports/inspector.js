/**
 * The DOM inspector: a mirror of the scene, one element per node over the
 * canvas, for DevTools and Playwright. Pass the class as the renderer's
 * `inspector` setting (`new RendererMain({ inspector: Inspector })`, or
 * `setOptions`), in a build with `__enableInspector__` on; an app that
 * does not import it ships none of it.
 *
 * @module Inspector
 */
export { Inspector, } from '../src/inspector/Inspector.js';
/**
 * The frame audit: what one drawn frame drew, why it batched the way it
 * did, and the breaks a scene change could avoid (`auditFrame`, then
 * `printFrameAudit`). Development only, like the inspector: an app that
 * does not import it ships none of it.
 */
export { auditFrame, formatFrameAudit, printFrameAudit, } from '../src/inspector/FrameAudit.js';
//# sourceMappingURL=inspector.js.map