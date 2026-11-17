import type { INodeProps, Node } from './Node.js';
/**
 * Apply a props bag to a node in 1.10 precedence order: group values first
 * (individual corner/axis values are applied afterwards so they win over
 * their shorthand), then the plain keys, then `parent` last. Cost is
 * proportional to the keys passed, not to the full prop set (spec 5.2).
 *
 * Applies to a fresh node (createNode); `null` and `undefined` both mean
 * "use the default", matching 1.10's `resolveNodeDefaults`, which used `??`
 * throughout (`props.alpha ?? 1`, `props.clipping ?? false`, the colour and
 * scale/mount/pivot chains, and so on) and so never distinguished an
 * explicit `null` from an omitted key. Every group check below and the
 * loop's skip both treat the two the same; a fresh node already carries the
 * correct default in its store slot, so skipping leaves the default in
 * place, whereas writing `null` through the setters would coerce it into a
 * live value instead (a Float64Array write coerces `null` to `0`, a colour
 * setter's `v >>> 0` also turns it into `0`, and `clipping`'s `v !== false`
 * test would make `null` clip).
 *
 * Plain keys are dispatched with `switch (key)`, one named store per case,
 * rather than a keyed store (`target[key] = value`) on the node itself: a
 * runtime string key landing on a prototype accessor is a megamorphic
 * keyed-store IC (a runtime call per prop) on Chrome 38's Crankshaft, and
 * node creation cost is a headline v2 goal (spec 1.1: 5x faster than 1.10).
 */
export declare function applyNodeProps(node: Node, props: Partial<INodeProps>): void;
