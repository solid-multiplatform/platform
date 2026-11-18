// Reads the services probe's report (services-probe.ts) and fails on any
// service that did not work on this target.
import { readFileSync } from 'node:fs';

const [target, file] = process.argv.slice(2);
const results = JSON.parse(readFileSync(file, 'utf8'));
console.log(JSON.stringify(results, null, 2));

const tv = target === 'apple-tv';
const phoneOnly = [
  'appReview',
  'battery',
  'biometrics',
  'clipboard',
  'geolocation',
  'haptics',
  'notifications',
  'share',
];
const everywhere = [
  'colorScheme',
  'connectivity',
  'deviceInfo',
  'fileSystem',
  'keepAwake',
  'keyEvents',
  'lifecycle',
  'locale',
  'mediaSession',
  'memory',
  'openExternal',
  'secureStorage',
  'settings',
];
// Installed by the host only when the application-delegate method they need
// is live. Where it is not, the service is absent: reported, not a failure.
const hooked = tv ? ['links'] : ['links', 'orientation'];
// errSecMissingEntitlement: an unsigned simulator build has no Keychain
// access group. Reported, never counted as verified.
const missingEntitlement = 'OSStatus -34018';
const failures = [];
const warn = (message) => console.log('::warning::' + target + ': ' + message);
const installed = (name) => results.installed?.includes(name) === true;
const passed = (name) =>
  typeof results[name] === 'string' && !results[name].startsWith('fail');

for (const name of everywhere)
  if (!installed(name)) failures.push(name + ' is not installed');
for (const name of phoneOnly) {
  const unavailable = results.unavailable?.includes(name) === true;
  if (tv && (installed(name) || !unavailable))
    failures.push(name + ' must be unavailable on tvOS');
  if (!tv && (!installed(name) || unavailable))
    failures.push(name + ' must be available on iOS');
}
if (tv && installed('orientation'))
  failures.push('orientation must be unavailable on tvOS');

const probed = [
  ...everywhere,
  // The share sheet is not presented: availability only.
  ...(tv ? [] : phoneOnly.filter((name) => name !== 'share')),
];
for (const name of hooked) {
  if (installed(name)) probed.push(name);
  else warn(name + ' ABSENT: the application delegate hook is not live');
}
for (const name of probed) {
  if (passed(name)) continue;
  if (
    name === 'secureStorage' &&
    String(results[name]).includes(missingEntitlement)
  ) {
    warn('secureStorage UNVERIFIED: ' + results[name]);
    continue;
  }
  failures.push(name + ': ' + results[name]);
}
if (tv && [...phoneOnly, 'orientation'].some((name) => name in results))
  failures.push('a phone-only service was probed on tvOS');

// These need the simulator to act on request from outside the app (switch
// appearance, open a URL without asking). A miss is reported and the
// behaviour stays unverified on this target.
const outside = { colorSchemeChange: 'colorScheme change' };
if (installed('links')) outside.linksFromSystem = 'links from simctl openurl';
const also = [];
for (const name of Object.keys(outside)) {
  if (passed(name)) also.push(outside[name]);
  else warn(outside[name] + ' UNVERIFIED: ' + results[name]);
}

if (failures.length) {
  console.error('Services probe failed on ' + target + ':');
  for (const failure of failures) console.error('  ' + failure);
  process.exit(1);
}
console.log('Services probe passed on ' + target + ': ' + probed.join(', '));
if (also.length) console.log('Also verified: ' + also.join(', '));
