/**
 * The Roku host: SceneGraph drawn from the device's own JavaScript engine.
 *
 *   startApp(rokuHost(), App, { fonts });
 *
 * `launch` registers the anchor node the channel's scene contains; the app
 * starts when the scene creates it and stops when the channel exits.
 */
import './components/BaseAppScene.xml';
import './components/WorkerTask.xml';
import './components/SolidMotionGroup.xml';
import './components/NativeTextDialogBridge.xml';
import { main, registerAnchorNode } from '@roku-sdk/rsg-ts';
import type { HostDefinition } from '@solid-multiplatform/platform/host';
import { createAnchor, type RokuHostOptions, type RokuSurface } from './anchor';

export type { RokuHostOptions, RokuSurface } from './anchor';
export { rokuKeyMap } from './keys';
export type { RokuDeviceInfo } from './services';

export function rokuHost(
  options: RokuHostOptions = {},
): HostDefinition<RokuSurface> {
  return {
    target: 'roku',
    capabilities: { inputs: ['remote'], colorScheme: false },
    launch(run) {
      main(() => registerAnchorNode(createAnchor(run, options)));
    },
  };
}
