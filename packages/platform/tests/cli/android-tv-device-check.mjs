import { execFileSync } from 'node:child_process';

const serial = process.env.ANDROID_SERIAL;
if (!serial) {
  console.log(
    JSON.stringify({ androidTv: false, reason: 'ANDROID_SERIAL missing' }),
  );
  process.exit(0);
}
const shell = (args) =>
  execFileSync('adb', ['-s', serial, 'shell', ...args], {
    encoding: 'utf8',
    timeout: 10_000,
  }).trim();
try {
  const focus =
    shell(['dumpsys', 'window']).match(/mCurrentFocus=([^\n]+)/)?.[1] ?? null;
  console.log(
    JSON.stringify({
      androidTv: true,
      model: shell(['getprop', 'ro.product.model']),
      release: shell(['getprop', 'ro.build.version.release']),
      sdk: shell(['getprop', 'ro.build.version.sdk']),
      focus,
    }),
  );
} catch (error) {
  console.log(JSON.stringify({ androidTv: false, reason: error.message }));
  process.exitCode = 1;
}
