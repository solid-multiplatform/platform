#!/usr/bin/env python3
"""Install rebuilt Canvas JNI libraries into this project's local AAR, atomically."""
import argparse, hashlib, json, os, pathlib, shutil, struct, subprocess, zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE_COMMIT = '04f0e69ce3129b46f37875758718d6f30ece1636'
TARGETS = {'armeabi-v7a': ('armv7-linux-androideabi', 40), 'arm64-v8a': ('aarch64-linux-android', 183), 'x86_64': ('x86_64-linux-android', 62)}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=pathlib.Path)
parser.add_argument('--abi', choices=TARGETS, action='append', default=[])
parser.add_argument('--restore', action='store_true')
args = parser.parse_args()
package = ROOT / 'node_modules/@nativescript/canvas'
assert json.loads((package / 'package.json').read_text())['version'] == '3.0.0-beta.6', 'Recheck the native patch before changing Canvas versions'
aar = package / 'platforms/android/canvas-release.aar'
artifacts = ROOT / '.artifacts/native-canvas'; artifacts.mkdir(parents=True, exist_ok=True)
backup = artifacts / 'canvas-original.aar'; manifest_path = artifacts / 'manifest.json'
temporary = aar.with_suffix('.tmp.aar')
if args.restore:
    if not backup.exists(): raise SystemExit('No original AAR backup exists')
    shutil.copyfile(backup, temporary); os.replace(temporary, aar)
    manifest_path.unlink(missing_ok=True)
    (ROOT / 'platforms/android/app/src/main/assets/app/native-canvas.json').unlink(missing_ok=True)
    print('Restored stock Canvas native libraries'); raise SystemExit(0)
if not args.source or not args.abi: parser.error('--source and at least one --abi are required')
source = args.source.resolve()
patch = ROOT.parents[1] / 'hosts/android-tv/patches/canvas-android-respect-antialias.patch'
subprocess.run(['git', 'merge-base', '--is-ancestor', SOURCE_COMMIT, 'HEAD'], cwd=source, check=True)
# A source checkout must contain the complete fix; never label an unpatched build.
subprocess.run(['git', 'apply', '--reverse', '--check', str(patch)], cwd=source, check=True, capture_output=True)
replacements = {}
for abi in args.abi:
    target, machine = TARGETS[abi]
    data = (source / 'target' / target / 'release/libcanvasnative.so').read_bytes()
    assert data[:4] == b'\x7fELF' and struct.unpack('<H', data[18:20])[0] == machine, f'Incorrect native architecture for {abi}'
    replacements[f'jni/{abi}/libcanvasnative.so'] = data
if not backup.exists(): shutil.copyfile(aar, backup)
previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
abis = {}
with zipfile.ZipFile(aar) as original, zipfile.ZipFile(temporary, 'w') as output:
    for info in original.infolist():
        data = replacements.get(info.filename)
        if data is None: data = original.read(info.filename)
        output.writestr(info, data)
        for abi, expected in previous.get('abis', {}).items():
            if info.filename == f'jni/{abi}/libcanvasnative.so' and hashlib.sha256(data).hexdigest() == expected:
                abis[abi] = expected
os.replace(temporary, aar)  # Avoid mutating pnpm's shared store through a hard link.
abis.update({abi: hashlib.sha256(replacements[f'jni/{abi}/libcanvasnative.so']).hexdigest() for abi in args.abi})
manifest = {
    'sourceCommit': SOURCE_COMMIT, 'patch': 'android-egl-respect-antialias',
    'patchSha256': hashlib.sha256(patch.read_bytes()).hexdigest(),
    'cargoLockSha256': hashlib.sha256((source / 'Cargo.lock').read_bytes()).hexdigest(),
    'abis': abis
}
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
print('Installed Canvas native fix for ' + ', '.join(args.abi))
