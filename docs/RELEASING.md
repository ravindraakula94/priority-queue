# Release and Signing Guide

[User guide](../README.md) | [Development and tests](DEVELOPMENT.md) | [Privacy notice](../PRIVACY.txt)

Distribute the **Windows NSIS installer**, not the intermediate standalone app executable. Do not commit build artifacts or private signing material.

## Prepare a version

1. Review the changes, migration compatibility, and user-facing release notes.
2. Update the version consistently in [package.json](../package.json), [package-lock.json](../package-lock.json), [Cargo.toml](../src-tauri/Cargo.toml), [Cargo.lock](../src-tauri/Cargo.lock), and [tauri.conf.json](../src-tauri/tauri.conf.json).
3. Run the [development validation checks](DEVELOPMENT.md#validation). Check the updated privacy notice and recapture documentation images when the UI changes.
4. Build and verify the versioned installer below. Disclose any checks that could not be completed.
5. Commit and push the source that produced the installer, then attach the verified artifacts to a release targeting that exact commit.

Version `v1.0.0` introduces encryption and permanent history deletion that were not in `v0.2.0`. Warn users that older plaintext-only versions cannot read migrated encrypted files and may overwrite them. Do not replace existing release assets with these changes under the old version number.

## Build the installer

From the repository root in PowerShell:

```powershell
.\scripts\Build-Windows.ps1
```

Output: `src-tauri/target/release/bundle/nsis/Priority Queue_<version>_x64-setup.exe`.

The helper adds conventional Node and Cargo locations to its process PATH, then reports the installer path, size, and SHA-256 hash. It does not install the app. `npm run desktop:build` also works when toolchains are already on PATH.

The installer is per-user, creates a Start menu entry, and can download the Microsoft WebView2 bootstrapper if the runtime is absent. This requires internet access on that machine. The app's runtime prerequisites do not include Node, Rust, or a .NET SDK.

`Build-Windows.ps1 -NoBundle` produces only an internal release executable for development. Native smoke tests instead require `npm run desktop:test-build`, which produces an isolated debug build. Never publish that debug executable.

## Self-signed builds

Self-signing detects later file modification and asserts a publisher name. It does **not** provide independently verified publisher identity, establish public trust, or guarantee removal of SmartScreen warnings. The `v1.0.0` installer uses a self-signed certificate named **Ravindra Akula**. The older `v0.2.0` release remains unsigned.

With PowerShell 7 and the Windows SDK installed:

```powershell
.\scripts\Initialize-SelfSigning.ps1
.\scripts\Build-Windows.ps1 -SelfSign
```

Setup creates a two-year SHA-256/RSA-3072 code-signing certificate, `CN=Ravindra Akula`, in `Cert:\CurrentUser\My`. Its non-exportable CNG software private key stays in the Windows profile, outside the repository. Rerunning setup reuses the configured identity. Certificate expiry or key loss requires explicit renewal or replacement.

A certificate's subject cannot be edited in place. To explicitly replace an existing signing identity, run `Initialize-SelfSigning.ps1 -Subject 'CN=Ravindra Akula' -Rotate`. This retains the previous public certificate and configuration under `.signing/previous-*` and leaves the previous certificate/private key in the user store. It then creates a new certificate/key and selects it for subsequent builds. Do not rotate on every build: the certificate fingerprint changes, and users who chose to trust an older certificate would need to evaluate the new identity separately.

The ignored `.signing/` directory contains:

- `tauri.windows.json`: local Tauri signing override with a certificate thumbprint and timestamp configuration.
- `PriorityQueue-SelfSigned.cer`: **public certificate only**, suitable for sharing with informed testers.

Never commit private-key containers or signing configuration. The scripts do not add certificates to Trusted Root or Trusted Publishers and do not require administrator access. Trust-store changes must be a separate, informed decision. Before anyone trusts the public certificate, provide its fingerprint through a channel they already trust; simply attaching it beside a download does not authenticate the publisher.

Tauri signs the packaged app, uninstaller, and setup executable. SignTool requests an RFC 3161 timestamp from `timestamp.digicert.com`, so signing uses the network. Timestamping records when signing took place; it does not make a self-signed identity trusted. Normal builds without `-SelfSign` remain unsigned. `-NoBundle -SelfSign` signs only the internal standalone executable.

Tauri restores the unsigned, unpatched intermediate `target/release/priority-queue.exe` after packaging. Verify the app extracted from the installer, not that intermediate file.

### Verify signatures

With 7-Zip installed:

```powershell
.\scripts\Test-SelfSigning.ps1
```

The script extracts into a temporary directory, checks signer and timestamp on the installer/app/uninstaller, and verifies that modifying a temporary app copy produces `HashMismatch`. It removes the temporary files and neither installs the app nor changes trust. Supply `-SevenZip` for a nonstandard 7-Zip location.

For a quick inspection of an individual artifact:

```powershell
Get-AuthenticodeSignature '.\path\to\installer-setup.exe' |
    Format-List Status, StatusMessage, SignerCertificate, TimeStamperCertificate
```

An **untrusted-root** result is expected until the certificate is explicitly trusted. `NotSigned` means no signature; `HashMismatch` indicates changed content. These are different outcomes. Signing changes file hashes, so calculate and publish checksums only after signing finishes.

## Validate the installer

```powershell
npm run test:installer
```

Requirements: PowerShell 7, a matching built installer/release executable, and **no existing installed or running Priority Queue**. Use a clean Windows test profile when the script refuses to run; do not uninstall a user's copy just to make a test pass.

The test installs into a temporary directory, compares the installed executable with the release build, checks update-mode startup preservation and normal uninstall cleanup, verifies normal app-data files did not change, and restores startup/installer registry values. It does not launch the installed app, avoiding unintended migration of real user data. Do not interrupt restoration.

**Signed-package caveat:** the current installer smoke test uses an exact binary-hash comparison. Tauri's packaged app differs from its restored intermediate when signing and bundle metadata are applied, so that comparison is not a valid signed-package identity check. Use `Test-SelfSigning.ps1` for signatures and test the signed install/upgrade/uninstall lifecycle on a clean profile. Do not report an unexecuted lifecycle check as passed.

Separately run `npm run desktop:test-build` and `npm run test:desktop` for the encrypted-storage and UI workflows. Before wider distribution, also test a real sign-out/sign-in, screen lock, migration from a backed-up older profile, and recovery expectations on a disposable Windows profile. Rust dependency auditing and runtime network monitoring remain separate security checks; signing does not replace them.

## Upgrade checks

Close the running app before installing a newer version. For an in-place upgrade of an installed copy that preserves startup registration:

```powershell
& '.\Priority Queue_<new-version>_x64-setup.exe' /UPDATE
```

Windows stores the startup choice per account. A full uninstall removes its startup entry; users can re-enable it in Settings after reinstalling. Task data is retained unless the uninstaller's delete-app-data option is selected. Users moving from the standalone app should close the old copy and use the newly installed one; both use the same app-data location.

After encryption migration, do not use `v0.2.0` or earlier against that profile. File-only backup/restore to a different Windows account is not a supported DPAPI recovery workflow. Include this warning in release notes until the relevant upgrade path is no longer current.

## Publish on GitHub

1. Open [the repository's Releases page](https://github.com/ravindraakula94/priority-queue/releases) and choose **Draft a new release**.
2. Choose a new tag, such as `v<version>`, pointing to the exact tested source commit. Use a matching release title.
3. Summarize changes, installation/upgrade steps, privacy or migration changes, validation results and gaps, and signing/trust status.
4. Attach the final matching **`*-setup.exe`** and [LICENSE](../LICENSE). For self-signed builds, optionally include the public `.cer` and explain how to verify its fingerprint. Do not attach private keys, `.signing` configuration, user data, test screenshots, debug builds, or the standalone app.
5. Include the final installer's SHA-256 hash. Keep the release as a draft while downloading its uploaded assets and comparing their hashes to the local originals.
6. Publish once verified, then check the public download, tag target, and latest-release status.

GitHub automatically supplies **Source code (zip)** and **Source code (tar.gz)** from the tag. Those are not installers. GitHub may normalize spaces in uploaded asset names to dots; verify content by hash rather than assuming the local filename is retained exactly.

The GitHub CLI is an alternative to the UI. Use a draft and an explicit `--target <commit>` with `gh release create`, then verify downloads before publishing. Older installed CLI versions may not support `gh release list --json`; `gh api repos/ravindraakula94/priority-queue/releases` provides release metadata.

Never silently replace an already published artifact with a different build or signature under the same version. Publish a new version with new checksums.