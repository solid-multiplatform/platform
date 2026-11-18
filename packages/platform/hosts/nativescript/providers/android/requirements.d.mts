import type { ServiceName } from '../../../../src/sdk/registry.js';

export type AndroidForm = 'phone' | 'tv';

/** An `<intent>` of the manifest's `<queries>`: the apps the app may look for. */
export interface AndroidQuery {
  action: string;
  category?: string;
  scheme?: string;
  mimeType?: string;
}

export interface AndroidManifestRequirements {
  /** `<uses-permission>` */
  permissions: { name: string }[];
  /** `<uses-feature android:required="false">` */
  features: { name: string; required: false }[];
  /** `<queries>` */
  queries: AndroidQuery[];
  /** `<provider>`: the FileProvider, with the `res/xml` file it reads. */
  providers: { name: string; authority: string; resource: string }[];
  /** Files under `res/`, by path, with their contents. */
  resources: Record<string, string>;
  /** `<service>`: the app's JobService classes. */
  services: { name: string; permission: string }[];
  /** Attributes of the launcher `<activity>`. */
  activity: Record<string, string>;
  /** Selected services the Android host for this form does not provide. */
  unavailable: ServiceName[];
}

export const FILE_PROVIDER: Readonly<{
  name: string;
  authority: string;
  resource: string;
}>;

/** Every service an Android host can provide. */
export const ANDROID_SERVICES: readonly ServiceName[];

export function androidServiceSupported(
  service: ServiceName,
  form: AndroidForm,
): boolean;

export function androidManifestRequirements(
  services: readonly ServiceName[],
  form: AndroidForm,
  options?: { jobs?: readonly string[] },
): AndroidManifestRequirements;

export function applyAndroidManifestRequirements(
  xml: string,
  requirements: AndroidManifestRequirements,
): string;
