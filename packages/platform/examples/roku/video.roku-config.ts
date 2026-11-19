// Builds the on-device video test app (tests/roku-device/video-app.tsx).
import { rokuConfig } from '@solid-multiplatform/platform/roku/preset';
export default rokuConfig({
  title: 'Solid Video',
  entry: '../../tests/roku-device/video-app.tsx',
});
