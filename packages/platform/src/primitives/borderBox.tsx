import {
  ElementNode,
  insertNode,
  type NodeProps,
  type NodeStyles,
} from '@solid-multiplatform/platform';
import { getOwner, runWithOwner, type Accessor } from 'solid-js';
import { chainFunctions } from '@solid-multiplatform/platform/primitives';
import { Config } from '../core/config.js';
import type { AnimationSettings } from '../core/intrinsicTypes.js';

export const BorderBoxStyle: NodeStyles = {
  alpha: 0.01,
  borderSpace: 6,
  borderRadius: 20,
  border: { color: 0xffffff, width: 2 },
  transition: { alpha: { duration: 100, easing: 'linear' } },
};

type BorderProps = NodeProps & { borderSpace?: number };

/** The box's fade settings, from the style's own alpha transition. */
const fadeSettings = (box: ElementNode): AnimationSettings => {
  const alpha =
    typeof box.transition === 'object' ? box.transition.alpha : undefined;
  return typeof alpha === 'object'
    ? alpha
    : { duration: 100, easing: 'linear' };
};

const borderComponent = (props: BorderProps) => {
  const space = props.borderSpace ?? (BorderBoxStyle.borderSpace as number);
  return (
    <view
      skipFocus
      onCreate={(el) => {
        const parent = el.parent!;
        el.width = parent.width + space * 2;
        el.height = parent.height + space * 2;
        el.alpha = 1;
      }}
      onDestroy={(el) => {
        // The directive's own exit has usually already run (the box left at
        // alpha 0): resolve at once so destroy() frees the node immediately.
        // Otherwise fade the box out and keep it attached until that lands.
        if (!Config.animationsEnabled || (el.alpha ?? 1) <= 0)
          return Promise.resolve();
        return el
          .animate({ alpha: 0 }, fadeSettings(el))
          .start()
          .waitUntilStopped();
      }}
      style={BorderBoxStyle}
      x={-space}
      y={-space}
      {...props}
    />
  );
};

// Solid directives can only be used on native root elements `view` and `text`
export function borderBox(
  el: ElementNode,
  accessor: Accessor<BorderProps | true | undefined>,
) {
  let border: ElementNode | null;
  // The running exit's controller, while a fade-out is in flight. A refocus
  // inside those 100 ms reuses the dying box instead of mounting a second one
  // beside it — a second box would paint a doubled focus ring until the first
  // finished fading.
  let exit: ReturnType<ElementNode['animate']> | undefined;
  const owner = getOwner();

  el.onFocusChanged = chainFunctions((f) => {
    if (f) {
      if (border && exit) {
        // Bring the same box back: stop the exit where it is, then fade up
        // through the style's own transition, which retargets from the box's
        // current alpha rather than replaying its completed entrance.
        exit.stop();
        exit = undefined;
        border.alpha = 1;
        return;
      }
      if (border) return;
      runWithOwner(owner, () => {
        const props = accessor();
        border = borderComponent(
          props === true || props === undefined ? {} : props,
        ) as unknown as ElementNode;
        insertNode(el, border);
        border.render();
      });
    } else if (border) {
      if (exit) return;
      if (!Config.animationsEnabled) {
        const box = border;
        border = null;
        el.removeChild(box);
        box.destroy();
        return;
      }
      const run = border.animate({ alpha: 0 }, fadeSettings(border)).start();
      exit = run;
      void run.waitUntilStopped().then(() => {
        // A refocus reused the box before the fade finished: leave it be.
        if (exit !== run) return;
        exit = undefined;
        const box = border;
        border = null;
        if (box) {
          el.removeChild(box);
          box.destroy();
        }
      });
    }
  }, el.onFocusChanged);
}
