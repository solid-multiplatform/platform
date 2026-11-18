// Compile-time proof that the WebGL backend satisfies the scene contract.
import type { SceneNode, SceneRenderer, SceneTextNode } from '../contracts.js';
import type { INode, ITextNode, RendererMain } from './exports/index.js';

type Satisfies<Contract, _Backend extends Contract> = true;
export type WebGLNode = Satisfies<SceneNode, INode>;
export type WebGLTextNode = Satisfies<SceneTextNode, ITextNode>;
export type WebGLRenderer = Satisfies<
  SceneRenderer<INode, ITextNode>,
  RendererMain
>;
