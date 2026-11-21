import {
  type Component,
  createEffect,
  createRenderEffect,
  createSignal,
} from 'solid-js';
import {
  ImageTexture,
  renderer,
  type NodeProps,
} from '@solid-multiplatform/platform';
import { Config } from '../core/config.js';

export interface ImageProps extends NodeProps {
  src: string;
  /** Image to load while src is being loaded. */
  placeholder?: string;
  fallback?: string;
  /** How the texture fits the node. Defaults to the renderer's cover mode. */
  fit?: 'cover' | 'contain';
}

export const Image: Component<ImageProps> = (props) => {
  const [texture, setTexture] = createSignal<ImageTexture | null>(null);
  const [src, setSrc] = createSignal<string | null>(props.placeholder || null);
  let generation = 0;

  // Follow placeholder/src changes immediately; the loaded image replaces the
  // placeholder once it arrives, and a stale load never overwrites a newer one.
  createEffect(() => {
    props.src;
    props.placeholder;
    setSrc(props.placeholder || null);
  });

  createRenderEffect(() => {
    const request = ++generation;
    if (Config.domRendererEnabled) {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (request === generation) setSrc(props.src);
      };
      if (props.fallback) {
        img.onerror = () => {
          if (props.fallback === props.placeholder) {
            return;
          }
          setSrc(props.fallback!);
        };
      }
      img.src = props.src;
      return;
    }

    const srcTexture = renderer.createTexture(
      'ImageTexture',
      props,
    ) as ImageTexture;

    if (props.fallback) {
      srcTexture.once('failed', () => {
        if (props.fallback === props.placeholder) {
          return;
        }
        setSrc(props.fallback!);
      });
    }

    // Renderer 2.x loads a texture only once a node shows it
    setTexture(srcTexture);
  });

  const viewProps = () => {
    const { fit, ...rest } = props;
    if (!fit) return rest;
    return {
      ...rest,
      textureOptions: {
        ...(rest.textureOptions ?? {}),
        resizeMode: { type: fit },
      },
    };
  };

  return (
    <view
      {...viewProps()}
      src={src()}
      color={props.color || 0xffffffff}
      texture={texture()}
    />
  );
};
