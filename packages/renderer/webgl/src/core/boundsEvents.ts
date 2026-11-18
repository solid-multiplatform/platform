import type { EventEmitter } from '../common/EventEmitter.js';
import type {
  NodeRenderablePayload,
  NodeViewportPayload,
} from '../common/types.js';
import type { FrameEvents } from './FrameEvents.js';
import type { NodeStore } from './nodes/NodeStore.js';
import {
  ST_RENDERABLE,
  VIS_IN_VIEWPORT,
  renderStateOf,
} from './nodes/NodeFlags.js';
import type { PassHooks } from './scene/ScenePass.js';
import { I_STATE, I_STRIDE } from './nodes/NodeLayout.js';

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
export function installBoundsEvents(
  hooks: PassHooks,
  nodes: NodeStore,
  events: FrameEvents,
): void {
  const visibility = hooks.onVisibility;
  hooks.onVisibility = (id, prev, next) => {
    visibility(id, prev, next);
    let name: string;
    if (next === VIS_IN_VIEWPORT) {
      name = 'inViewport';
    } else if (prev === VIS_IN_VIEWPORT) {
      name = 'outOfViewport';
    } else {
      return;
    }
    const node = nodes.handles[id] as EventEmitter | null;
    if (node === null || node.hasListener(name) === false) {
      return;
    }
    const payload: NodeViewportPayload = {
      previous: renderStateOf(prev),
      current: renderStateOf(next),
    };
    events.queue(node, name, payload);
  };
  const tell = (id: number, renderable: boolean): void => {
    const node = nodes.handles[id] as EventEmitter | null;
    if (node === null || node.hasListener('renderable') === false) {
      return;
    }
    const payload: NodeRenderablePayload = {
      type: 'renderable',
      isRenderable: renderable,
    };
    events.queue(node, 'renderable', payload);
  };
  hooks.onRenderable = tell;
  // The sweep reaches a descendant before its stale ST_RENDERABLE is ever
  // re-derived (the culled node itself has re-derived it, false, already):
  // it is told false, and the bit goes with the event (it is not drawn
  // while hidden), so that the visit that shows it again re-derives it
  // (ScenePass raises DIRTY_RENDERABLE there) and onRenderable reports
  // true only if it is renderable then, as 1.10's world alpha did: a
  // texture freed, a colour cleared or a move out of the viewport while
  // hidden tells nothing more.
  const hidden = hooks.onHidden;
  hooks.onHidden = (id) => {
    const wants = hidden(id);
    const state = nodes.u32[id * I_STRIDE + I_STATE]!;
    if ((state & ST_RENDERABLE) === 0) {
      return wants;
    }
    tell(id, false);
    nodes.u32[id * I_STRIDE + I_STATE] = state & ~ST_RENDERABLE;
    // Marked ST_HIDDEN: the pass re-derives it when it shows it again.
    return true;
  };
}
