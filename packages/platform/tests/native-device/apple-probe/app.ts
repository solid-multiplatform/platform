// The app tests/cli/apple-smoke.sh builds: the Swift plugin and playback
// check by default, the services probe when launched with
// SOLID_SERVICES_PROBE set.
import { mount as mountMedia } from './media-fixture';
import { runServicesProbe } from './services-probe';

export function mount(
  plugins: unknown,
  fonts: unknown,
  input: unknown,
  host: { target: string },
): () => void {
  if (
    NSProcessInfo.processInfo.environment.objectForKey('SOLID_SERVICES_PROBE')
  ) {
    void runServicesProbe(host.target === 'apple-tv' ? 'tv' : 'phone');
    return () => {};
  }
  return mountMedia(plugins, fonts, input, host);
}
