// Compile-time proof that the Canvas 2D backend satisfies the scene contract.
import type { SceneNode, SceneRenderer, SceneTextNode } from '../contracts.js';
import type { INode, ITextNode } from './src/main-api/INode.js';
import type { RendererMain } from './index.js';

type Satisfies<Contract, _Backend extends Contract> = true;
export type CanvasNode = Satisfies<SceneNode, INode>;
export type CanvasTextNode = Satisfies<SceneTextNode, ITextNode>;
export type CanvasRenderer = Satisfies<
  SceneRenderer<INode, ITextNode>,
  RendererMain
>;
