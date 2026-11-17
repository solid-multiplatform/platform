import type { CoreNode, CoreNodeAnimateProps } from '../CoreNode.js';
import { getTimingFunction, type TimingFunction } from '../utils.js';
import type {
  AnimationConfig,
  AnimationManager,
  PropValues,
} from './AnimationManager.js';

export interface AnimationSettings {
  duration: number;
  adaptiveDuration: boolean;
  delay: number;
  easing: string | TimingFunction;
  loop: boolean;
  /**
   * Number of times to play. Not implemented by this renderer's animation
   * manager (WebGL/Canvas play once unless `loop` is set); honoured by
   * solid's DOM renderer, which shares this type.
   */
  repeat: number;
  stopMethod: 'reverse' | false;
}

export function createAnimation(
  manager: AnimationManager,
  node: CoreNode,
  props: Partial<CoreNodeAnimateProps>,
  settings: Partial<AnimationSettings>,
): AnimationConfig {
  const easing = settings.easing || 'linear';
  const delay = settings.delay ?? 0;
  let propValues: Record<string, PropValues> | null = null;
  let shaderPropValues: Record<string, PropValues> | null = null;
  // Flattened, index-aligned views of the two records above. `applyValues`
  // walks these every frame instead of `for...in`-ing a dictionary-mode
  // object. Entries are shared by reference with the records, so in-place
  // mutation (`reverseValues`) is visible through both.
  let propKeys: string[] | null = null;
  let propList: PropValues[] | null = null;
  let shaderPropKeys: string[] | null = null;
  let shaderPropList: PropValues[] | null = null;

  for (const key in props) {
    if (key !== 'shaderProps') {
      if (!propValues) {
        propValues = {};
        propKeys = [];
        propList = [];
      }
      const value: PropValues = {
        start:
          node[key as keyof Omit<CoreNodeAnimateProps, 'shaderProps'>] || 0,
        target: props[
          key as keyof Omit<CoreNodeAnimateProps, 'shaderProps'>
        ] as number,
        isColor: key.indexOf('color') !== -1,
      };
      propValues[key] = value;
      propKeys!.push(key);
      propList!.push(value);
    } else if (key === 'shaderProps' && node.shader !== null) {
      if (!shaderPropValues) {
        shaderPropValues = {};
        shaderPropKeys = [];
        shaderPropList = [];
      }
      for (const shaderKey in props.shaderProps) {
        let start = node.shader.props![shaderKey];
        if (Array.isArray(start)) {
          start = start[0];
        }
        const value: PropValues = {
          start: start as number,
          target: props.shaderProps[shaderKey] as number,
          isColor: shaderKey.indexOf('color') !== -1,
        };
        shaderPropValues[shaderKey] = value;
        shaderPropKeys!.push(shaderKey);
        shaderPropList!.push(value);
      }
    }
  }

  const timingFunction =
    typeof easing === 'string' ? getTimingFunction(easing) : easing;

  const config: AnimationConfig = {
    manager,
    node,
    duration: settings.duration ?? 0,
    delay,
    delayFor: delay,
    progress: 0,
    loop: settings.loop ?? false,
    repeat: settings.repeat ?? 0,
    stopMethod: settings.stopMethod ?? false,
    timingFunction,
    state: 'stopped',
    props: propValues,
    shaderProps: shaderPropValues,
    propKeys,
    propList,
    shaderPropKeys,
    shaderPropList,
    stoppedResolve: null,
    stoppedPromise: null,
    lastRunTime: settings.adaptiveDuration ? performance.now() : 0,

    start() {
      if (this.state !== 'running' && this.state !== 'scheduled') {
        if (!this.stoppedPromise) {
          this.stoppedPromise = new Promise((resolve) => {
            this.stoppedResolve = resolve;
          });
        }
        this.manager.registerAnimation(this);
        this.state = 'scheduled';
      }
      return this;
    },

    stop() {
      this.manager.unregisterAnimation(this);
      if (this.stoppedResolve) {
        this.stoppedResolve();
        this.stoppedResolve = null;
      }
      // Reset values
      this.progress = 0;
      this.delayFor = this.delay;
      this.state = 'stopped';
      return this;
    },

    pause() {
      this.manager.unregisterAnimation(this);
      this.state = 'paused';
      return this;
    },

    restore() {
      this.stoppedResolve = null;
      this.stop();
      if (this.props) {
        const entries = Object.entries(this.props);
        for (let i = 0; i < entries.length; i++) {
          const [k, v] = entries[i]!;
          (this.node as unknown as Record<string, number>)[k] = v.start;
        }
      }
      if (this.shaderProps && this.node.shader) {
        const entries = Object.entries(this.shaderProps);
        for (let i = 0; i < entries.length; i++) {
          const [k, v] = entries[i]!;
          (this.node.shader.props as Record<string, number>)[k] = v.start;
        }
      }
      return this;
    },

    waitUntilStopped() {
      if (!this.stoppedPromise) {
        this.stoppedPromise = Promise.resolve();
      }
      return this.stoppedPromise;
    },
  };

  return config;
}
