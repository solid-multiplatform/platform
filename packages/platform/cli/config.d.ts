/**
 * The schema of `solid-platform.config.{mjs,js,json}` at the app root.
 *
 * A `.mjs` or `.js` file default-exports this object and must not use
 * top-level await. `solid-platform init` writes the `.json` form.
 */
export type TargetName =
  | 'web'
  | 'tizen'
  | 'webos'
  | 'vizio'
  | 'roku'
  | 'android'
  | 'android-tv'
  | 'ios'
  | 'apple-tv'
  | 'desktop';

/** Settings a target needs to sign a release. Values are never credentials. */
export interface SigningSettings {
  /** Android: path to the keystore, relative to the app root. */
  keystore?: string;
  /** Android: the key alias inside the keystore. */
  alias?: string;
  /** Android: name of the environment variable holding the keystore password. */
  storePasswordEnv?: string;
  /** Android: name of the environment variable holding the key password. */
  keyPasswordEnv?: string;
  /** Tizen: the security profile `tizen package` signs with. */
  profile?: string;
  [setting: string]: string | undefined;
}

export interface SolidPlatformConfig {
  /**
   * Reverse-DNS application id, such as `com.example.app`. Used for the webOS
   * app id and to start the app on Android. Native projects keep the id that
   * `init` wrote into `targets/<target>/nativescript.config.ts`.
   */
  id?: string;
  /** Lowercase letters, digits and hyphens; up to 50 characters. */
  name: string;
  /** `major.minor.patch`, written into Tizen and webOS package manifests. */
  version?: string;
  /** The targets this app builds. Each has a directory under `targets/`. */
  targets: TargetName[];
  /** One icon file, or files by size or purpose. Paths are relative to the app root. */
  icons?: string | Record<string, string>;
  /** One splash image, or files by purpose. Paths are relative to the app root. */
  splash?: string | Record<string, string>;
  deepLinks?: {
    /** Custom URL schemes without `://`, such as `myapp`. */
    schemes?: string[];
    /** Hosts whose https links open the app. */
    hosts?: string[];
  };
  /** Names of the platform services the app uses. */
  services?: string[];
  /** Signing settings by target. Passwords are named by environment variable, never stored. */
  signing?: Partial<Record<TargetName, SigningSettings>>;
}

/** What targets receive as `ctx.config`: validated, with the optional lists filled in. */
export interface ResolvedConfig extends SolidPlatformConfig {
  deepLinks: { schemes: string[]; hosts: string[] };
  services: string[];
  signing: Partial<Record<TargetName, SigningSettings>>;
  /** The file the settings came from. */
  source: string;
}

export function validateConfig(
  raw: unknown,
  source?: string,
  allowed?: readonly string[],
): ResolvedConfig;
export function loadConfig(root: string): ResolvedConfig;
export function findConfig(root: string): string | undefined;
export const configFiles: string[];
