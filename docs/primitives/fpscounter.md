# FPSCounter

`FPSCounter` is a development overlay. It shows the current, average, minimum
and maximum frames per second, the quad and render-op counts, and texture
memory.

The numbers come from the renderer's `fpsUpdate` and `renderUpdate` events and
from its `memoryInfo()`. The WebGL backend raises `fpsUpdate` only when the
renderer setting `fpsUpdateInterval` is set. `memoryInfo()` is optional in the
scene contract, so use the counter with a backend that has it.

```tsx
import { renderer } from '@solid-multiplatform/platform';
import { FPSCounter, setupFPS } from '@solid-multiplatform/platform/primitives';

export const App = () => {
  setupFPS({ renderer });

  return (
    <view>
      <FPSCounter mountX={1} x={1910} y={10} />
    </view>
  );
};
```

- `setupFPS(root)`: subscribes to the events of `root.renderer`. Call it once,
  after the renderer exists.
- `FPSCounter`: accepts every `<view>` prop.
- `resetCounter()`: clears the average and the minimum.

Samples of 5 fps or less are ignored. They occur while a page loads.

Do not leave the counter in a production build. With `fpsUpdateInterval` set,
the renderer reports on an interval, which breaks the rule that an idle scene
schedules nothing.
