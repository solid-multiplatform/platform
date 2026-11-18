import type {
  MediaCapabilities,
  MediaCapabilitiesPort,
} from '../../../../src/sdk/drm.js';
import type { AndroidApp } from './runtime.js';

// DRM systems by the name the web gives them and the UUID Android knows.
const DRM: readonly (readonly [string, string])[] = [
  ['com.widevine.alpha', 'edef8ba9-79d6-4ace-a3c8-27dcd51d21ed'],
  ['com.microsoft.playready', '9a04f079-9840-4286-ab92-e65be0885f95'],
  ['org.w3.clearkey', 'e2719d58-a985-b3c9-781a-b030af78d30e'],
];

/**
 * What the device can decode and protect: `MediaDrm` for DRM systems,
 * `MediaCodecList` for decoders, the display's HDR types. Codecs are the
 * decoders' MIME types as Android names them (`video/avc`, `video/hevc`,
 * `audio/mp4a-latm`), not web codec strings. Read once, on first request.
 */
export function mediaCapabilities(app: AndroidApp): MediaCapabilitiesPort {
  let known: MediaCapabilities | undefined;
  const read = (): MediaCapabilities => {
    const drm = DRM.filter(([, uuid]) =>
      android.media.MediaDrm.isCryptoSchemeSupported(
        java.util.UUID.fromString(uuid),
      ),
    ).map(([name]) => name);
    const codecs = new Set<string>();
    const list = new android.media.MediaCodecList(
      android.media.MediaCodecList.REGULAR_CODECS,
    ).getCodecInfos();
    for (let i = 0; i < list.length; i++) {
      const codec = list[i]!;
      if (codec.isEncoder()) continue;
      const types = codec.getSupportedTypes();
      for (let j = 0; j < types.length; j++) codecs.add(String(types[j]));
    }
    const displays: android.hardware.display.DisplayManager =
      app.context.getSystemService(android.content.Context.DISPLAY_SERVICE);
    const types = displays
      .getDisplay(android.view.Display.DEFAULT_DISPLAY)
      ?.getHdrCapabilities()
      ?.getSupportedHdrTypes();
    return {
      drm,
      codecs: Array.from(codecs).sort(),
      hdr: (types?.length ?? 0) > 0,
    };
  };
  return {
    async get() {
      return (known ??= read());
    },
  };
}
