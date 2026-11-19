/** The app's window scene, for the UIKit calls that are made on a scene. */
export function windowScene(): UIWindowScene | undefined {
  const scenes = UIApplication.sharedApplication.connectedScenes.allObjects;
  for (let i = 0; i < scenes.count; i++) {
    const scene = scenes.objectAtIndex(i);
    if (scene instanceof UIWindowScene) return scene;
  }
  return undefined;
}
