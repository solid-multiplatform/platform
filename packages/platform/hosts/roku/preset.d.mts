import type { RokuConfig } from '@roku-sdk/rsg-ts/roku-config';
export function rokuConfig(options: {
  /** The app's entry module: the one that calls `startApp(rokuHost(), App)`. */
  entry: string;
  assets?: string;
  title: string;
  /** `major.minor.build`. Defaults to `1.0.1`. */
  version?: string;
  /** Home screen icons, PNG: `fhd` 540x405, `hd` 290x218. */
  icons?: { fhd?: string; hd?: string };
  /** Splash screens, PNG: `fhd` 1920x1080, `hd` 1280x720, `sd` 720x480. */
  splash?: { fhd?: string; hd?: string; sd?: string; color?: string };
  /** Opts in to Instant Resume (`sdk_instant_resume=1`): suspend and resume reach the `lifecycle` service. */
  instantResume?: boolean;
  manifestEntries?: Record<string, string | number>;
}): RokuConfig;
