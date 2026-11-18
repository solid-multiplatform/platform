// Compile-time proof that the DOM test backend satisfies the scene contract.
import type { SceneNode, SceneRenderer, SceneTextNode } from '../contracts.js';
import type { DOMRendererMain } from './domRenderer.js';
import type { IRendererNode, IRendererTextNode } from './domRendererTypes.js';

type Satisfies<Contract, _Backend extends Contract> = true;
export type DomNode = Satisfies<SceneNode, IRendererNode>;
export type DomTextNode = Satisfies<SceneTextNode, IRendererTextNode>;
export type DomRenderer = Satisfies<
  SceneRenderer<IRendererNode, IRendererTextNode>,
  DOMRendererMain
>;
