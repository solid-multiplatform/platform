# Releasing

The three packages (`renderer`, `platform`, `video`) are versioned together. A release is a git tag. The workflow `.github/workflows/release.yml` does the rest, with the helper `scripts/release.mjs`.

## Cut a release

1. Set the version in every package:

   ```sh
   node scripts/release.mjs set 0.3.0-beta.1
   ```

   This writes the version to the three `package.json` files. It also sets the platform's peer dependency on the renderer to the same version: the platform names the exact renderer it was built and tested with.

2. Commit the change and merge it to `main`.

3. Tag the commit `v<version>` and push the tag:

   ```sh
   git tag v0.3.0-beta.1
   git push origin v0.3.0-beta.1
   ```

## What the workflow does

On a pushed tag that starts with `v`, the `release` job:

1. Runs `node scripts/release.mjs check <tag>`. It fails unless every package is at the tag's version, and tells you the `set` command to run.
2. Installs, builds and runs `pnpm test`.
3. Runs `node scripts/release.mjs pack release`. This packs each package with `pnpm pack`, which rewrites `workspace:` dependencies to real versions and runs `prepack`, and writes `SHA256SUMS` next to the archives.
4. Uploads the `release` directory as the workflow artifact `packages`.
5. Creates the GitHub release for the tag with the archives and the checksums, with generated notes. A version with a pre-release part, such as `0.3.0-beta.1`, is marked as a pre-release.
6. Publishes the same archives to npm, with provenance, only when the repository has an `NPM_TOKEN` secret. Pre-releases get the `next` dist-tag and other versions get `latest`.

GitHub Releases is the primary channel. npm is published when a token exists.

## Dry run

Start the workflow by hand and give it a tag. It runs the check, the build, the tests and the pack, and uploads the archives as an artifact. Nothing is published.

You can run the same steps locally:

```sh
node scripts/release.mjs check v0.3.0-beta.1
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm test
node scripts/release.mjs pack release
```

## What a release does not prove

The release job runs the unit tests. It does not run the browser, project, Apple or Android jobs; those run on the commit through `test.yml` and `android.yml` before you tag. No release step runs on a physical device. The [feature matrix](/features.md) is the statement of what is tested where.

`apple-artifacts.yml` and `desktop-artifacts.yml` build downloadable simulator and desktop packages when started by hand. They are not part of a release.
