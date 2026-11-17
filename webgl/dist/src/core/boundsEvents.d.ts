import type { FrameEvents } from './FrameEvents.js';
import type { NodeStore } from './nodes/NodeStore.js';
import type { PassHooks } from './scene/ScenePass.js';
/**
 * 1.10's bounds events (`__emitBoundsEvents__`, spec 12.2): `inViewport`
 * when a node enters the viewport, `outOfViewport` when it leaves it (into
 * the bounds margin or out of bounds), with the 1.10 render states before
 * and after, and `renderable` when it starts or stops being drawn. The
 * scene pass raises them (`onVisibility`, which the texture system holds
 * and this chains, never replaces, and `onRenderable`); they are queued on
 * the frame's events, so no listener runs inside the walk (the Renderer
 * delivers them after the draw), and only for a node listening to the
 * event as it is raised. RendererCore installs them when the flag is on:
 * a build that defines it false drops this module.
 *
 * A subtree hidden by world alpha 0 is not visited, so its renderable
 * descendants hear `renderable` false from the hidden sweep (`onHidden`,
 * also the texture system's, chained), and their renderability goes with
 * the event: they are not drawn while hidden. The scene pass re-derives it
 * on the visit that shows them again (it raises DIRTY_RENDERABLE there in
 * a build with the flag on), so `onRenderable` tells true only if they are
 * renderable then, as 1.10, which propagated world alpha to every node,
 * told them. Once per transition: a hidden frame calls no hook.
 */
export declare function installBoundsEvents(hooks: PassHooks, nodes: NodeStore, events: FrameEvents): void;
