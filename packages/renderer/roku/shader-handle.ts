import type { RokuNode } from './node.js';

/**
 * Renderer shader handle: a kind and the effect props drawn for it. The props
 * are a copy of what was passed, as a WebGL shader's are, so that the values
 * drawn change only through `props`; writes there redraw the nodes.
 */
export class ShaderHandle {
  shaderType: string;
  name: string;
  props: any;
  nodes = new Set<RokuNode>();
  destroyed = false;
  constructor(name: string, props: any) {
    this.name = name;
    this.shaderType = name;
    const raw = { ...props };
    this.props = new Proxy(raw, {
      set: (target: any, key: string, value: any) => {
        target[key] = value;
        this.nodes.forEach(node => node.effectDirty());
        return true;
      },
      deleteProperty: (target: any, key: string) => {
        delete target[key];
        this.nodes.forEach(node => node.effectDirty());
        return true;
      }
    });
  }
  destroy() {
    this.destroyed = true;
    this.nodes.clear();
  }
}
