# Signed macOS releases and update channels

SAM LAB ships two explicit GitHub release channels. **Stable** is the default and is generated from version tags. **Main preview** is opt-in in **Settings → Updates** and is generated from `main`. Neither channel auto-downloads or auto-installs.

## Security invariants

- Production packaging fails when Apple code signing is unavailable (`forceCodeSigning: true`).
- Every DMG and ZIP is built for both Apple Silicon (`arm64`) and Intel (`x64`). The ZIP is required by the macOS updater.
- Release applications use hardened runtime, Apple Developer ID signing, notarization and stapling.
- SAM LAB verifies that the currently installed application has a Developer ID Application identity before enabling update checks.
- `electron-updater` and macOS enforce the downloaded application signature during replacement.
- Download and installation are separate user actions. Installation also requires a native confirmation dialog.
- Main preview uses a separate `main` feed and never bypasses the stable channel's signing policy.
- A local ad-hoc `dir` package is permitted only through `npm run package:mac:dir`; its updater remains blocked.

## Required GitHub Actions secrets

Configure these repository or environment secrets. Never commit their values:

| Secret | Value |
| --- | --- |
| `MACOS_CERTIFICATE_P12` | Base64-encoded Developer ID Application `.p12` certificate |
| `MACOS_CERTIFICATE_PASSWORD` | Password for the `.p12` certificate |
| `APPLE_API_KEY_P8` | App Store Connect API key contents |
| `APPLE_API_KEY_ID` | App Store Connect key ID |
| `APPLE_API_ISSUER` | App Store Connect issuer ID |

`GITHUB_TOKEN` is supplied by Actions with `contents: write`. The workflow fails before packaging if any Apple credential is absent.

## Publish stable

1. Ensure `main` is green and the version is ready.
2. Create and push an immutable semantic-version tag such as `v0.2.0`.
3. The workflow builds, signs, notarizes and publishes four artifacts: x64/arm64 DMG and x64/arm64 ZIP, plus update metadata.
4. Do not mark the release complete unless every verification command in CI passes.

## Main preview

A maintainer explicitly dispatches **Signed macOS releases** from a selected `main` commit to publish a prerelease version such as `0.2.0-main.123` to the separate `main` feed. Ordinary pushes never attempt a release, so missing Apple credentials cannot break normal development. A user must select **Main preview** and click **Check**, **Download**, then **Restart & install**. Returning to Stable clears the pending preview selection.

## Local verification

After downloading a release, verify the mounted application:

```bash
codesign --verify --deep --strict --verbose=2 "/Applications/SAM LAB.app"
spctl --assess --type execute --verbose=4 "/Applications/SAM LAB.app"
xcrun stapler validate "/Applications/SAM LAB.app"
```

The CI workflow runs the same checks on every packaged `.app`. An unsigned or unnotarized build is a failed release, not a warning.
