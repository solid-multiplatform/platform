// Compile-time proof that the Roku SceneGraph backend satisfies the scene contract.
import type { SceneNode, SceneRenderer, SceneTextNode } from '../contracts.js';
import type { RokuNode } from './node.js';
import type { SceneGraphRenderer } from './renderer.js';

type Satisfies<Contract, _Backend extends Contract> = true;
export type RokuSceneNode = Satisfies<SceneNode, RokuNode>;
export type RokuSceneTextNode = Satisfies<SceneTextNode, RokuNode>;
export type RokuRenderer = Satisfies<
  SceneRenderer<RokuNode, RokuNode>,
  SceneGraphRenderer
>;
