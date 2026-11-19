// The visual test screen with the SceneGraph backend held to its image tier,
// the one a Roku without the Effect node (DirectFB, or before Roku OS 16)
// gets. Run on a device that has Effect, this checks the generated images
// and the reported gaps; it does not stand in for a DirectFB device.
import { mountWith } from './visual-app';

export function mount(): () => void {
  return mountWith('assets');
}
