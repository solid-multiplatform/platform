/** What an app's Xcode project must declare for the services it uses. */
export interface AppleInfoPlistRequirements {
  /** Info.plist keys whose value is the sentence the permission prompt shows. */
  usageDescriptions: string[];
  /** Values of `UIBackgroundModes`. */
  backgroundModes: string[];
  /** Other Info.plist keys the app has to fill in. */
  infoPlistKeys: string[];
  /** Entitlement keys the signing profile must carry. */
  entitlements: string[];
}

type Requirement = Partial<AppleInfoPlistRequirements> & {
  /** False when tvOS has no such service: it then requires nothing there. */
  tv?: false;
};

const requirements: Readonly<Record<string, Requirement>> = {
  biometrics: { usageDescriptions: ['NSFaceIDUsageDescription'], tv: false },
  calendar: {
    usageDescriptions: ['NSCalendarsFullAccessUsageDescription'],
    tv: false,
  },
  contacts: { usageDescriptions: ['NSContactsUsageDescription'], tv: false },
  geolocation: { usageDescriptions: ['NSLocationWhenInUseUsageDescription'] },
  jobs: {
    backgroundModes: ['fetch'],
    infoPlistKeys: ['BGTaskSchedulerPermittedIdentifiers'],
  },
  links: {
    infoPlistKeys: ['CFBundleURLTypes'],
    entitlements: ['com.apple.developer.associated-domains'],
  },
  mediaSession: { backgroundModes: ['audio'] },
  push: {
    backgroundModes: ['remote-notification'],
    entitlements: ['aps-environment'],
  },
  sensors: { usageDescriptions: ['NSMotionUsageDescription'], tv: false },
};

/**
 * The Info.plist usage descriptions, background modes, other keys and
 * entitlements the selected services need on a phone or a TV. Services that
 * need nothing (settings, Keychain, clipboard, ...) contribute nothing.
 */
export function appleInfoPlistRequirements(
  services: readonly string[],
  form: 'phone' | 'tv',
): AppleInfoPlistRequirements {
  const result: AppleInfoPlistRequirements = {
    usageDescriptions: [],
    backgroundModes: [],
    infoPlistKeys: [],
    entitlements: [],
  };
  for (const name of services) {
    const needs = requirements[name];
    if (!needs || (form === 'tv' && needs.tv === false)) continue;
    for (const key of Object.keys(result) as (keyof typeof result)[])
      for (const value of needs[key] ?? [])
        if (!result[key].includes(value)) result[key].push(value);
  }
  for (const key of Object.keys(result) as (keyof typeof result)[])
    result[key].sort();
  return result;
}
