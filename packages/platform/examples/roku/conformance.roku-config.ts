// Builds the on-device scene conformance app (tests/roku-device).
import { rokuConfig } from '@solid-multiplatform/platform/roku/preset';
export default rokuConfig({
  title: 'Solid Conformance',
  entry: '../../tests/roku-device/conformance-app.ts',
});
