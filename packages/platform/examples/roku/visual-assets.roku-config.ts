// Builds the on-device visual test app held to the image tier
// (tests/roku-device/visual-app-assets.tsx).
import { rokuConfig } from '@solid-multiplatform/platform/roku/preset';
export default rokuConfig({
  title: 'Solid Visual (image tier)',
  entry: '../../tests/roku-device/visual-app-assets.tsx',
});
