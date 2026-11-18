import type { CoreShaderType } from '../../renderers/CoreShaderNode.js';
import { validateArrayLength4, type PrefixedType } from '../utils.js';

export interface ShadowProps {
  /**
   * Shadow Color
   *
   * @default 0x000000ff
   */
  color: number;
  /**
   * Shadow Projection [offsetX, offsetY, blur, spread]
   *
   * @default [0, 0, 5, 5]
   */
  projection: [number, number, number, number];
  /**
   * OffsetX of Shadow (center)
   *
   * @default 0
   */
  x: number;
  /**
   * OffsetY of Shadow (center)
   *
   * @default 0
   */
  y: number;
  /**
   * Blur along the edges of the Shadow
   *
   * @default 5
   */
  blur: number;
  /**
   * Spread of the shadow compared to node
   *
   * @default 5
   */
  spread: number;
}

export function getShadowProps<P extends string>(
  prefix?: P,
): PrefixedType<ShadowProps, P> {
  const pf = prefix && prefix.length > 0 ? `${prefix}-` : '';
  const projection = pf + 'projection';

  return {
    [pf + 'color']: 0x000000ff,
    [projection]: {
      default: [0, 0, 5, 5],
      resolve(value) {
        if (value !== undefined) {
          return validateArrayLength4(value);
        }
        return ([] as number[]).concat(this.default);
      },
    },
    [pf + 'x']: {
      default: 0,
      set(value, props) {
        props[projection][0] = value;
      },
      get(props) {
        return props[projection][0];
      },
    },
    [pf + 'y']: {
      default: 0,
      set(value, props) {
        props[projection][1] = value;
      },
      get(props) {
        return props[projection][1];
      },
    },
    [pf + 'blur']: {
      default: 5,
      set(value, props) {
        props[projection][2] = value;
      },
      get(props) {
        return props[projection][2];
      },
    },
    [pf + 'spread']: {
      default: 5,
      set(value, props) {
        props[projection][3] = value;
      },
      get(props) {
        return props[projection][3];
      },
    },
  } as PrefixedType<ShadowProps, P>;
}

type PlainShadowProps = PrefixedType<ShadowProps>;

export const ShadowTemplate: CoreShaderType<ShadowProps> = {
  props: getShadowProps() as PlainShadowProps,
};
