/// <reference path="./entry.d.ts" />
import { defineAnchorNode } from '@roku-sdk/rsg-ts';
import { KeyHandler } from '@roku-sdk/components';
import { createElement, onCleanup, onMount } from '@roku-sdk/solid';
import { SceneGraphRenderer } from '@solid-multiplatform/renderer/roku';
import { dispatchNativeKey, installBrowserServices } from './browser-services';
import { createNativeTextEntry } from './native-text-entry';
import { setTaskRoot } from './worker-task';
import { createRokuVideoApi, type RokuVideoFactory } from './video-bridge';

export default defineAnchorNode(
  {
    componentName: 'SolidApp',
    extends: 'Group' as const,
    inputFields: {},
    outputFields: {},
  },
  () => {
    const root = createElement('group');
    let scene: SceneGraphRenderer | undefined;
    let text: ReturnType<typeof createNativeTextEntry> | undefined;
    let disposeApp: (() => void) | undefined;
    let uninstall: (() => void) | undefined;
    let active = true;
    onMount(async () => {
      setTaskRoot(root);
      installBrowserServices();
      text = createNativeTextEntry(root);
      const platform = await import('@solid-multiplatform/platform');
      if (!active) return;
      platform.Config.preventDefaultOnHandledKeys = true;
      const factory: import('@solid-multiplatform/platform').RendererFactory = (
        settings,
        target,
      ) =>
        (scene = new SceneGraphRenderer(
          settings,
          typeof target === 'string' ? root : target,
        ));
      // The fonts an app loads with `loadFonts`: each font file it imported
      // (`fontUrl`) is registered with the scene. An entry for another
      // backend (an SDF atlas) has no file to register here.
      platform.setRendererFactory(factory, (fonts) =>
        Promise.all(
          fonts.map((font) =>
            scene && typeof font.fontUrl === 'string'
              ? scene.loadFont(font as never)
              : undefined,
          ),
        ).then(() => undefined),
      );
      uninstall = () => {
        if (platform.getRendererFactory() === factory)
          platform.setRendererFactory(undefined);
      };
      const app = await import('solid-app-entry');
      const video = createRokuVideoApi(
        root,
        (app as { createVideoPlayer?: RokuVideoFactory }).createVideoPlayer,
      );
      if (active)
        disposeApp = app.mount({
          target: 'roku',
          root,
          textEntry: text,
          video,
        });
    });
    onCleanup(() => {
      active = false;
      disposeApp?.();
      text?.dispose();
      scene?.destroy();
      uninstall?.();
      setTaskRoot(undefined);
    });
    return (
      <KeyHandler
        handleAllKeys
        gainFocus
        onKeyEvent={({ key, press }) =>
          dispatchNativeKey(key, press, () => text?.ownsInput() ?? false)
        }
      >
        {root as unknown as import('solid-js').JSX.Element}
      </KeyHandler>
    );
  },
);
