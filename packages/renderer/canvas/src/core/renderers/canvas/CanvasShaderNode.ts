import type { CoreNode } from '../../CoreNode.js';
import { normalizeCanvasColor } from '../../lib/colorCache.js';
import type { Stage } from '../../Stage.js';
import { CoreShaderNode, type CoreShaderType } from '../CoreShaderNode.js';

export type CanvasShaderType<
  T extends object = Record<string, unknown>,
  C extends object = Record<string, unknown>,
> = CoreShaderType<T> & {
  render: (
    this: CanvasShaderNode<T, C>,
    ctx: CanvasRenderingContext2D,
    node: CoreNode,
    renderContext: () => void,
  ) => void;
  update?: (this: CanvasShaderNode<T, C>, node: CoreNode) => void;
  /**
   * Set this to true when using ctx functions that scale, clip, rotate, etc..
   */
  saveAndRestore?: boolean;
};

export class CanvasShaderNode<
  Props extends object = Record<string, unknown>,
  Computed extends object = Record<string, unknown>,
> extends CoreShaderNode<Props> {
  computed: Partial<Computed> = {};
  applySNR: boolean;
  render: CanvasShaderType<Props>['render'];

  constructor(
    shaderKey: string,
    config: CanvasShaderType<Props>,
    stage: Stage,
    props?: Props,
  ) {
    super(shaderKey, config, stage, props);
    this.applySNR = config.saveAndRestore || false;
    this.render = config.render;
    if (config.update !== undefined) {
      this.installUpdater(config.update);
    }
  }

  protected override resetValues(): Record<string, unknown> {
    const computed = {};
    this.computed = computed;
    return computed;
  }

  protected override adoptValues(values: Record<string, unknown>): void {
    this.computed = values as Partial<Computed>;
  }

  toColorString(rgba: number) {
    return normalizeCanvasColor(rgba, true);
  }
}
