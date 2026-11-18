// The DOM test backend against the shared scene conformance cases.
import { test } from 'vitest';
import { sceneConformance } from '@solid-multiplatform/renderer/conformance';
import {
  DOMRendererMain,
  type DOMNode,
} from '@solid-multiplatform/renderer/dom';
import './setup.js';

for (const c of sceneConformance({
  create() {
    const target = document.body.appendChild(document.createElement('div'));
    return new DOMRendererMain({ appWidth: 1920, appHeight: 1080 }, target);
  },
  settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
  childrenOf(node) {
    const parent = node as unknown as DOMNode;
    const divs = Array.from(parent.div.children);
    return Array.from(parent.children).sort(
      (a, b) => divs.indexOf(a.div) - divs.indexOf(b.div),
    );
  },
}))
  test('DOM backend: ' + c.name, c.run);
