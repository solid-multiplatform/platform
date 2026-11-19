/**
 * The SceneGraph side of the Roku host: one anchor node (`SolidApp`) whose
 * group is the app's surface. It starts the app when the scene mounts it,
 * feeds remote keys to the host's key source, and stops the app when the
 * scene goes away.
 */
import { defineAnchorNode, FieldType } from '@roku-sdk/rsg-ts';
import { KeyHandler } from '@roku-sdk/components';
import {
  createElement,
  createEffect,
  insertNode,
  onCleanup,
  onMount,
  setProp,
} from '@roku-sdk/solid';
import { Config } from '@solid-multiplatform/platform';
import type {
  Disposer,
  HostContext,
} from '@solid-multiplatform/platform/host';
import {
  installServices,
  loadService,
  peekService,
  serviceAvailable,
} from '@solid-multiplatform/platform/services';
import { SceneGraphRenderer } from '@solid-multiplatform/renderer/roku';
import { rokuEditorHost } from './editor';
import { createKeySource } from './keys';
import { createNativeTextEntry } from './native-text-entry';
import { reportError } from './report';
import { createRokuMotionHost } from './native-motion';
import { rokuServices, signalLaunchComplete } from './services';
import { setTaskRoot } from './worker-task';

/** The SceneGraph group the app draws in. */
export type RokuSurface = object;

export interface RokuHostOptions {
  /**
   * The registry section this app's settings live in. Defaults to `app`.
   */
  namespace?: string;
  /**
   * Run `x`, `y` and `alpha` animations on SceneGraph's render thread.
   * Defaults to true; `false` keeps every property on the JS clock.
   */
  nativeMotion?: boolean;
}

/** The app failed to start: say so on screen instead of leaving it black. */
function showBootError(
  root: ReturnType<typeof createElement>,
  error: unknown,
): void {
  const message =
    error instanceof Error ? error.stack || error.message : String(error);
  reportError('ROKU_BOOT_ERROR', error);
  const panel = createElement('rectangle');
  setProp(panel, 'width', 1920);
  setProp(panel, 'height', 1080);
  setProp(panel, 'color', '0x5A0000FF');
  insertNode(root, panel);
  const title = createElement('label');
  setProp(title, 'translation', [120, 120]);
  setProp(title, 'color', '0xFFFFFFFF');
  setProp(title, 'text', 'This app could not start');
  insertNode(root, title);
  const detail = createElement('label');
  setProp(detail, 'translation', [120, 220]);
  setProp(detail, 'width', 1680);
  setProp(detail, 'wrap', true);
  setProp(detail, 'maxLines', 16);
  setProp(detail, 'color', '0xFFFFFFFF');
  setProp(detail, 'text', message);
  insertNode(root, detail);
}

export function createAnchor(
  run: (context: HostContext<RokuSurface>) => Disposer,
  options: RokuHostOptions,
) {
  return defineAnchorNode(
    {
      componentName: 'SolidApp',
      extends: 'Group' as const,
      // The video adapter talks to the scene's Video layer through these: a
      // JSON command out and a JSON event back in. Both are inert when the
      // app does not play video.
      inputFields: { videoevent: FieldType.String('') },
      // Set when Back was pressed and nothing in the app handled it. The
      // scene observes it and the channel's main loop closes the screen.
      outputFields: {
        exitApp: FieldType.Boolean(false),
        videocommand: FieldType.String(''),
      },
    },
    (inputs, outputs) => {
      const videoListeners = new Set<(event: unknown) => void>();
      createEffect(() => {
        const raw = inputs.videoevent;
        if (!raw) return;
        let event: unknown;
        try {
          event = JSON.parse(raw);
        } catch (error) {
          reportError('ROKU_VIDEO event is not JSON', error);
          return;
        }
        // A copy: a listener may unsubscribe while it runs.
        for (const listener of Array.from(videoListeners)) {
          try {
            listener(event);
          } catch (error) {
            reportError('ROKU_VIDEO listener failed', error);
          }
        }
      });
      const root = createElement('group');
      const keys = createKeySource();
      const entry = createNativeTextEntry(root);
      // The keyboard dialog takes the remote as it opens.
      const text: typeof entry = {
        ...entry,
        open(request) {
          keys.releaseAll();
          return entry.open(request);
        },
      };
      let stop: Disposer | undefined;
      let removeServices: (() => void) | undefined;
      onMount(() => {
        setTaskRoot(root);
        // The focus manager marks a handled key by `preventDefault`; that is
        // how the key source learns whether Back was consumed.
        Config.preventDefaultOnHandledKeys = true;
        removeServices = installServices(
          rokuServices(options.namespace ?? 'app', keys),
        );
        // The video adapter's seam: commands go out through the anchor's
        // output field, events arrive on its input field. Only true firmware
        // features are listed; the adapter fills the rest with its documented
        // set, because an unknown feature key also answers false.
        const firmware = (globalThis as { roku?: { hasFeature?(key: string): boolean } }).roku;
        let features: Record<string, boolean> | undefined;
        if (typeof firmware?.hasFeature === 'function') {
          features = {};
          for (const key of [
            'hevc',
            'hdr10',
            'dolby_vision',
            'widevine',
            'playready',
            'fairplay',
            'dash',
            '4k',
            'uhd',
          ])
            if (firmware.hasFeature(key)) features[key] = true;
        }
        const videoHost = {
          send: (command: string) => outputs.videocommand(command),
          subscribe(listener: (event: unknown) => void) {
            videoListeners.add(listener);
            return () => videoListeners.delete(listener);
          },
          features: () => features,
          // The provider is installed by `rokuServices`; its port type is
          // declared in `src/sdk/media.ts`, which this host build does not
          // pull in (see `rokuMediaSession`).
          mediaSession: (
            peekService as unknown as (
              name: string,
            ) => Record<string, unknown> | undefined
          )('mediaSession'),
        };
        (globalThis as Record<string, unknown>).__smpRokuVideoHost = videoHost;
        onCleanup(() => {
          if (
            (globalThis as Record<string, unknown>).__smpRokuVideoHost ===
            videoHost
          )
            delete (globalThis as Record<string, unknown>).__smpRokuVideoHost;
          videoListeners.clear();
        });
        // A channel that opted in to Instant Resume must answer the
        // firmware's suspend and resume whether or not the app listens.
        if (serviceAvailable('lifecycle') === 'available')
          loadService('lifecycle').catch((error: unknown) =>
            reportError('ROKU_LIFECYCLE unavailable', error),
          );
        let scene: SceneGraphRenderer | undefined;
        try {
          stop = run({
            target: 'roku',
            surface: root,
            native: root,
            keys,
            text: rokuEditorHost(text, (reason) =>
              reportError('ROKU_EDITOR', reason),
            ),
            createRenderer: (settings) =>
              (scene = new SceneGraphRenderer(
                settings,
                root,
                // Native motion is on unless the app turns it off; a host
                // without it falls back to the JS clock for every property.
                options.nativeMotion === false
                  ? {}
                  : createRokuMotionHost(),
              )),
            // Each font file the app imported is registered with the scene.
            // An entry for another backend (an SDF atlas) has no file here.
            loadFonts: (fonts) =>
              Promise.all(
                fonts.map((font) =>
                  scene && typeof font.fontUrl === 'string'
                    ? scene.loadFont(font as never)
                    : undefined,
                ),
              ).then(() => undefined),
          });
        } catch (error) {
          showBootError(root, error);
        }
        // The first screen is ready once the scene has written its first
        // frame; with no scene (a boot error) it is ready now.
        if (scene && stop) scene.once('idle', signalLaunchComplete);
        else signalLaunchComplete();
      });
      onCleanup(() => {
        try {
          stop?.();
        } finally {
          text.dispose();
          removeServices?.();
          setTaskRoot(undefined);
        }
      });
      return (
        <KeyHandler
          handleAllKeys
          gainFocus
          onKeyEvent={({ key, press }) => {
            // The system keyboard dialog has the remote while it is open.
            if (text.ownsInput()) return;
            const handled = keys.dispatch(key, press);
            if (!handled && press && key === 'back') outputs.exitApp(true);
          }}
        >
          {root as unknown as import('solid-js').JSX.Element}
        </KeyHandler>
      );
    },
  );
}
