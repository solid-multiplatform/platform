// What each Android service needs in the app's manifest. Plain data and pure
// functions with no imports, so the CLI can load this file from an installed
// package as it is, and tests can run it anywhere.

const permission = (name) => 'android.permission.' + name;

/** The FileProvider `share` and `camera` hand files to other apps through. */
export const FILE_PROVIDER = Object.freeze({
  name: 'androidx.core.content.FileProvider',
  authority: '${applicationId}.solid.files',
  resource: 'solid_file_paths',
});

const FILE_PATHS = `<?xml version="1.0" encoding="utf-8"?>
<paths>
  <files-path name="files" path="." />
  <cache-path name="cache" path="." />
</paths>
`;

/**
 * Per service: `phone` for the ones a TV has no use for, then what the
 * manifest must declare. A service with nothing to declare is `{}`. A service
 * that is not here has no Android provider.
 */
const SERVICES = {
  clipboard: {},
  share: {
    queries: [{ action: 'android.intent.action.SEND', mimeType: '*/*' }],
    fileProvider: true,
  },
  haptics: { phone: true, permissions: [permission('VIBRATE')] },
  deviceInfo: {},
  battery: {},
  memory: {},
  keepAwake: {},
  orientation: { phone: true },
  systemBars: { phone: true },
  appReview: { phone: true },
  openExternal: {
    queries: [
      {
        action: 'android.intent.action.VIEW',
        category: 'android.intent.category.BROWSABLE',
        scheme: 'https',
      },
    ],
  },
  settings: {},
  secureStorage: {},
  lifecycle: {},
  connectivity: { permissions: [permission('ACCESS_NETWORK_STATE')] },
  links: {},
  notifications: {
    phone: true,
    permissions: [permission('POST_NOTIFICATIONS')],
  },
  jobs: {},
  locale: {},
  colorScheme: {},
  keyEvents: {},
  biometrics: {
    phone: true,
    permissions: [permission('USE_BIOMETRIC')],
    features: ['android.hardware.fingerprint'],
  },
  camera: {
    features: ['android.hardware.camera.any'],
    queries: [{ action: 'android.media.action.IMAGE_CAPTURE' }],
    fileProvider: true,
  },
  fileSystem: {},
  filePicker: {
    queries: [
      {
        action: 'android.intent.action.OPEN_DOCUMENT',
        category: 'android.intent.category.OPENABLE',
        mimeType: '*/*',
      },
    ],
  },
  download: { permissions: [permission('INTERNET')] },
  geolocation: {
    permissions: [
      permission('ACCESS_COARSE_LOCATION'),
      permission('ACCESS_FINE_LOCATION'),
    ],
    // The permissions imply these as required; a TV has neither.
    features: [
      'android.hardware.location',
      'android.hardware.location.gps',
      'android.hardware.location.network',
    ],
  },
  sensors: {},
  maps: {
    phone: true,
    queries: [{ action: 'android.intent.action.VIEW', scheme: 'geo' }],
  },
  contacts: { phone: true, permissions: [permission('READ_CONTACTS')] },
  calendar: { phone: true, permissions: [permission('READ_CALENDAR')] },
  audio: { permissions: [permission('INTERNET')] },
  mediaSession: {},
  fullscreen: {
    activity: { 'android:supportsPictureInPicture': 'true' },
  },
  mediaCapabilities: {},
};

/** Every service an Android host can provide, in manifest order. */
export const ANDROID_SERVICES = Object.freeze(Object.keys(SERVICES));

/** Whether the Android host for `form` has a provider for the service. */
export function androidServiceSupported(service, form) {
  const entry = Object.hasOwn(SERVICES, service) ? SERVICES[service] : null;
  return entry !== null && (form === 'phone' || !entry.phone);
}

/**
 * The manifest entries the selected services need on a phone or a TV:
 * permissions, optional features, package-visibility queries, the
 * FileProvider and its paths resource, job services and attributes of the
 * launcher activity. `jobs` lists the app's JobService class names. Services
 * with no Android provider for the form are returned in `unavailable` and
 * contribute nothing.
 */
export function androidManifestRequirements(services, form, options = {}) {
  if (form !== 'phone' && form !== 'tv')
    throw new TypeError('Unknown Android form: ' + form);
  const permissions = new Set();
  const features = new Set();
  const queries = new Map();
  const activity = {};
  const unavailable = [];
  let fileProvider = false;
  for (const service of new Set(services)) {
    if (!androidServiceSupported(service, form)) {
      unavailable.push(service);
      continue;
    }
    const entry = SERVICES[service];
    for (const name of entry.permissions ?? []) permissions.add(name);
    for (const name of entry.features ?? []) features.add(name);
    for (const query of entry.queries ?? [])
      queries.set(JSON.stringify(query), query);
    Object.assign(activity, entry.activity);
    fileProvider ||= entry.fileProvider === true;
  }
  const jobs =
    services.includes('jobs') && androidServiceSupported('jobs', form)
      ? (options.jobs ?? [])
      : [];
  return {
    permissions: [...permissions].map((name) => ({ name })),
    features: [...features].map((name) => ({ name, required: false })),
    queries: [...queries.values()],
    providers: fileProvider ? [{ ...FILE_PROVIDER }] : [],
    resources: fileProvider
      ? { [`xml/${FILE_PROVIDER.resource}.xml`]: FILE_PATHS }
      : {},
    services: jobs.map((name) => ({
      name,
      permission: permission('BIND_JOB_SERVICE'),
    })),
    activity,
    unavailable,
  };
}

const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;');

/**
 * Adds the requirements to an AndroidManifest.xml and returns the new text.
 * Permissions and features the manifest already names are left as they are;
 * activity attributes go on the first `<activity>`, where it does not set
 * them already. Applying the same requirements twice changes nothing more.
 */
export function applyAndroidManifestRequirements(xml, requirements) {
  const named = (tag, name) =>
    new RegExp(
      `<${tag}\\b[^>]*android:name="${name.replaceAll('.', '\\.')}"`,
    ).test(xml);
  const top = [];
  for (const { name } of requirements.permissions)
    if (!named('uses-permission', name))
      top.push(`  <uses-permission android:name="${escape(name)}" />`);
  for (const { name } of requirements.features)
    if (!named('uses-feature', name))
      top.push(
        `  <uses-feature android:name="${escape(name)}" android:required="false" />`,
      );
  const intents = requirements.queries
    .map((query) => {
      const data = [
        query.scheme ? `android:scheme="${escape(query.scheme)}"` : '',
        query.mimeType ? `android:mimeType="${escape(query.mimeType)}"` : '',
      ].filter(Boolean);
      return (
        `    <intent>\n      <action android:name="${escape(query.action)}" />\n` +
        (query.category
          ? `      <category android:name="${escape(query.category)}" />\n`
          : '') +
        (data.length ? `      <data ${data.join(' ')} />\n` : '') +
        '    </intent>'
      );
    })
    .filter((intent) => !xml.includes(intent));
  if (intents.length) top.push('  <queries>', ...intents, '  </queries>');
  const inside = [];
  for (const provider of requirements.providers)
    if (!named('provider', provider.name))
      inside.push(
        `    <provider android:name="${escape(provider.name)}" android:authorities="${escape(provider.authority)}"\n` +
          '        android:exported="false" android:grantUriPermissions="true">\n' +
          `      <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/${escape(provider.resource)}" />\n` +
          '    </provider>',
      );
  for (const service of requirements.services)
    if (!named('service', service.name))
      inside.push(
        `    <service android:name="${escape(service.name)}" android:permission="${escape(service.permission)}" android:exported="false" />`,
      );
  const insert = (text, marker, lines) => {
    if (!lines.length) return text;
    const at = text.indexOf(marker);
    if (at < 0) throw new Error('AndroidManifest.xml has no ' + marker);
    const start = text.lastIndexOf('\n', at) + 1;
    return text.slice(0, start) + lines.join('\n') + '\n' + text.slice(start);
  };
  let next = insert(xml, '<application', top);
  next = insert(next, '</application>', inside);
  const attributes = Object.entries(requirements.activity).filter(
    ([name]) => !/<activity\b[^>]*>/.exec(next)?.[0].includes(name + '='),
  );
  if (attributes.length) {
    if (!next.includes('<activity '))
      throw new Error('AndroidManifest.xml has no <activity>');
    next = next.replace(
      '<activity ',
      '<activity ' +
        attributes
          .map(([name, value]) => `${name}="${escape(value)}"`)
          .join(' ') +
        ' ',
    );
  }
  return next;
}
