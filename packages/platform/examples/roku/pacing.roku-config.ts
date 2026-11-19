// Builds the on-device frame-pacing workload (tests/roku-device/pacing-app.tsx).
import { rokuConfig } from '@solid-multiplatform/platform/roku/preset';
export default rokuConfig({
  title: 'Solid Pacing',
  entry: '../../tests/roku-device/pacing-app.tsx',
});
