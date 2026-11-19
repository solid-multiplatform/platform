// Builds the on-device visual test app (tests/roku-device/visual-app.tsx).
import { rokuConfig } from '@solid-multiplatform/platform/roku/preset';
export default rokuConfig({
  title: 'Solid Visual',
  entry: '../../tests/roku-device/visual-app-native.tsx',
});
