#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
native_root="$PWD"
canvas_source="$native_root/.artifacts/canvas-source"
abis=()
while (($#)); do
  case "$1" in
    --source) canvas_source="$2"; shift 2 ;;
    --abi) abis+=("$2"); shift 2 ;;
    *) echo "Usage: $0 [--source PATH] [--abi armeabi-v7a|arm64-v8a|x86_64]" >&2; exit 2 ;;
  esac
done
if ((${#abis[@]} == 0)); then abis=(armeabi-v7a arm64-v8a x86_64); fi
mkdir -p "$native_root/.artifacts"
revision=04f0e69ce3129b46f37875758718d6f30ece1636
patch="$native_root/../../hosts/android-tv/patches/canvas-android-respect-antialias.patch"
if ! git -C "$canvas_source" rev-parse --git-dir >/dev/null 2>&1; then
  mkdir -p "$canvas_source"
  git -C "$canvas_source" init
  git -C "$canvas_source" remote add origin https://github.com/NativeScript/canvas.git
  git -C "$canvas_source" fetch --depth 1 --filter=blob:none origin "$revision"
  git -C "$canvas_source" sparse-checkout set crates .cargo
  git -C "$canvas_source" checkout --detach FETCH_HEAD
fi
git -C "$canvas_source" merge-base --is-ancestor "$revision" HEAD
if ! git -C "$canvas_source" apply --reverse --check "$patch" 2>/dev/null; then
  git -C "$canvas_source" apply --check "$patch"
  git -C "$canvas_source" apply "$patch"
fi
cp "$native_root/../../hosts/android-tv/patches/canvas-Cargo.lock" "$canvas_source/Cargo.lock"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_NDK="${ANDROID_NDK:-$ANDROID_HOME/ndk/28.2.13676358}"
export ANDROID_NDK_HOME="$ANDROID_NDK"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
canvas_tools="$ANDROID_NDK/toolchains/llvm/prebuilt/linux-x86_64/bin"
install_args=(--source "$canvas_source")
for abi in "${abis[@]}"; do
  case "$abi" in
    armeabi-v7a) target=armv7-linux-androideabi; compiler=armv7a-linux-androideabi23 ;;
    arm64-v8a) target=aarch64-linux-android; compiler=aarch64-linux-android23 ;;
    x86_64) target=x86_64-linux-android; compiler=x86_64-linux-android23 ;;
    *) echo "Unsupported ABI: $abi" >&2; exit 2 ;;
  esac
  target_env="${target//-/_}"
  linker_env="CARGO_TARGET_${target_env^^}_LINKER"
  (
    cd "$canvas_source"
    # The stable toolchain is sufficient; avoid upstream's nightly-only size flags.
    env "CC_$target_env=$canvas_tools/$compiler-clang" \
      "CXX_$target_env=$canvas_tools/$compiler-clang++" \
      "AR_$target_env=$canvas_tools/llvm-ar" \
      "$linker_env=$canvas_tools/$compiler-clang" \
      RUSTFLAGS='-C link-arg=-Wl,--hash-style=sysv -C link-arg=-Wl,--gc-sections -C link-arg=-Wl,-z,max-page-size=16384' \
      flock "$native_root/.artifacts/canvas-build.lock" cargo build --locked --release --target "$target" -p canvas-android
  )
  install_args+=(--abi "$abi")
done
python3 scripts/install-canvas-native.py "${install_args[@]}"
