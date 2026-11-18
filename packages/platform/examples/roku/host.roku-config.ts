// Builds the on-device host test app (tests/roku-device/host-app.tsx).
import { rokuConfig } from '@solid-multiplatform/platform/roku/preset';
export default rokuConfig({
  title: 'Solid Host',
  entry: '../../tests/roku-device/host-app.tsx',
  instantResume: true,
});
