// Builds the on-device motion test app (tests/roku-device/motion-app.tsx).
import { rokuConfig } from '@solid-multiplatform/platform/roku/preset';
export default rokuConfig({
  title: 'Solid Motion',
  entry: '../../tests/roku-device/motion-app.tsx',
});
