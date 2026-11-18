// Builds the on-device text test app (tests/roku-device/text-app.tsx).
import { rokuConfig } from '@solid-multiplatform/platform/roku/preset';
export default rokuConfig({
  title: 'Solid Text',
  entry: '../../tests/roku-device/text-app.tsx',
});
