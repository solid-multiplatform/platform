// Reads the services probe's report (services-probe.ts) and fails on any
// service that did not work on this target.
import { readFileSync } from 'node:fs';

const [target, file] = process.argv.slice(2);
const results = JSON.parse(readFileSync(file, 'utf8'));
console.log(JSON.stringify(results, null, 2));

const tv = target === 'apple-tv';
const phoneOnly = ['battery', 'clipboard', 'haptics', 'share'];
const everywhere = [
  'colorScheme',
  'connectivity',
  'deviceInfo',
  'keepAwake',
  'keyEvents',
  'lifecycle',
  'locale',
  'memory',
  'openExternal',
  'secureStorage',
  'settings',
];
// errSecMissingEntitlement: an unsigned simulator build has no Keychain
// access group. Reported, never counted as verified.
const missingEntitlement = 'OSStatus -34018';
const failures = [];
const passed = (name) =>
  typeof results[name] === 'string' && !results[name].startsWith('fail');

for (const name of everywhere) {
  if (results.installed?.includes(name) !== true)
    failures.push(name + ' is not installed');
}
for (const name of phoneOnly) {
  const installed = results.installed?.includes(name) === true;
  const unavailable = results.unavailable?.includes(name) === true;
  if (tv && (installed || !unavailable))
    failures.push(name + ' must be unavailable on tvOS');
  if (!tv && (!installed || unavailable))
    failures.push(name + ' must be available on iOS');
}
const probed = [
  ...everywhere,
  // The share sheet is not presented: availability only.
  ...(tv ? [] : phoneOnly.filter((name) => name !== 'share')),
];
for (const name of probed) {
  if (passed(name)) continue;
  if (
    name === 'secureStorage' &&
    String(results[name]).includes(missingEntitlement)
  ) {
    console.log(
      '::warning::secureStorage UNVERIFIED on ' + target + ': ' + results[name],
    );
    continue;
  }
  failures.push(name + ': ' + results[name]);
}
if (tv && phoneOnly.some((name) => name in results))
  failures.push('a phone-only service was probed on tvOS');

if (failures.length) {
  console.error('Services probe failed on ' + target + ':');
  for (const failure of failures) console.error('  ' + failure);
  process.exit(1);
}
console.log('Services probe passed on ' + target + ': ' + probed.join(', '));
