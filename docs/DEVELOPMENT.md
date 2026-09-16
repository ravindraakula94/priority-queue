# Development Guide

[User guide](../README.md) | [Release and signing guide](RELEASING.md) | [Privacy notice](../PRIVACY.txt)

## Prerequisites

- Windows 10/11 x64 for native builds and desktop tests.
- Node.js 22 LTS (22.13 or newer) or a supported newer LTS, with npm.
- Rust stable, Visual Studio C++ build tools, and the Windows SDK.
- PowerShell 7 for the helper scripts; installed Microsoft Edge for Playwright.
- Microsoft WebView2 for the native app. A .NET SDK is not required.

## Run locally

From the repository root:

```powershell
npm ci
npm run dev
```

The browser preview is at http://127.0.0.1:1421. Vite binds to loopback and uses a strict port. Override it with `npm run dev -- --port 1422` if needed; native development also requires the matching `devUrl` in [tauri.conf.json](../src-tauri/tauri.conf.json).

```powershell
npm run desktop:dev
```

The browser starts in full view and uses **separate, unencrypted local storage**. It cannot reproduce desktop transparency, native window positioning, Windows startup registration, or lock notifications. Do not treat browser preview as the encrypted desktop app.

Normal native development uses the same app-data location as the installed app. Use the isolated test workflows below when working on storage or migration, and do not launch old plaintext-only versions against encrypted data.

## Validation

```powershell
npm test
npm run test:e2e
npm run build
npm run lint
cargo check --manifest-path src-tauri/Cargo.toml
npm run test:storage
npm run desktop:test-build
npm run test:desktop
```

| Check | Coverage |
| --- | --- |
| `npm test` | Queue ordering, timer accounting, completion modes, lock timestamps, day boundaries, permanent deletion, and retained-history cleanup |
| `npm run test:e2e` | Browser workflows, persistence, keyboard/pointer reordering, filters, deletion, privacy/save retry, long text, and second-tab protection |
| `npm run build` / `lint` | TypeScript, Vite production bundle, and ESLint |
| `npm run test:storage` | DPAPI round trips, atomic migration, tamper/future-format rejection, fixed targets, failed writes, and concurrent preferences |
| `npm run test:desktop` | Actual WebView2 UI, encrypted files, rejected storage commands, startup settings, saved overlay geometry across restart, deletion, privacy, and lock auto-pause |

Playwright starts or reuses the preview server. Browser screenshots, traces, and failure details go to the ignored `test-results/` directory; these are not the README's maintained images. The Playwright channel is configured in [playwright.config.ts](../playwright.config.ts).

### Desktop test isolation

`desktop:test-build` creates `src-tauri/target/debug/priority-queue.exe` with the frontend bundled. The smoke script requires that debug executable and refuses a separately supplied installed executable. Close any running Priority Queue first; single-instance protection applies to tests too.

Only debug builds honor `PRIORITY_QUEUE_TEST_DATA_DIR`. The smoke test uses it to seed temporary legacy data **before launch**, so neither startup migration nor subsequent writes touch real user data. Production builds ignore the variable and always use their normal app-data directory. No frontend command accepts an arbitrary storage path.

The test temporarily exercises startup registry settings, restores both the Run and StartupApproved values in cleanup, and compares hashes of normal task/preference files. Do not interrupt it during cleanup. Synthetic lock/unlock messages target only its hidden session-listener window and do not lock the workstation. A manual sign-in and Win+L check on a test profile is still useful.

Installer lifecycle checks have separate prerequisites; see [release validation](RELEASING.md#validate-the-installer).

## Refresh README screenshots

The maintained images in [docs/images](images/) are real Windows WebView2 captures of the current source with fictional tasks. No app UI is mocked or restyled. Dialogs and the activity section are cropped to the actual component; overlay images preserve transparency.

```powershell
npm run desktop:test-build
node scripts/Capture-ReadmeScreenshots.mjs
```

Close the desktop app first. The capture script uses a debug-only temporary profile, fixed demo dates, bundled fonts, and a local WebView2 debugging port (`9225`). It does not enable/disable autostart or edit real tasks, and checks real data-file hashes afterward. The Settings screenshot reflects the existing Windows startup setting without changing it. The script checks UI states, closes its window, and deletes temporary data.

Inspect all seven images at README display sizes before committing. Commit the PNGs along with documentation changes. Keep the README's release-availability note accurate: screenshots of current source may show features newer than the downloadable installer.

## Storage and timing

The native API reads only `queue` or `preferences`, writes the queue, and updates the two permitted preference keys. Tauri grants these commands to the main local window. The general-purpose Store plugin is not used.

Windows DPAPI protects versioned data envelopes; logical filenames remain `queue.json` and `preferences.json`, but their contents are encrypted binary data. The encrypted envelope binds the format version and dataset identity, preventing accidental swapping of the two files. Writes use a temporary ciphertext file and atomic replacement. Valid legacy JSON migrates in place without leaving a plaintext backup; corrupted, unsupported, or undecryptable files fail closed.

DPAPI keys belong to the Windows profile. There is no portable export, separate recovery key, or app password. Encryption does not erase prior backups or disk remnants and does not protect against a compromised same-user process. Never edit ciphertext manually or downgrade to a plaintext-only app after migration. See [PRIVACY.txt](../PRIVACY.txt) for user-facing details.

Timing is timestamp-based rather than accumulated interval ticks. Active sessions checkpoint every five seconds, normal close waits for a save, and persisted state restores paused. Windows lock timestamps trim late checkpoints so locked time is not charged. Sleep without a lock still counts; switching apps does not pause. Daily summaries split sessions at local midnight.

Deletion removes the task and every session with its ID. Legacy orphaned sessions remain until a user explicitly confirms cleanup; completed and archived tasks still retain history. A failed save must be retried before deletion is durable.

## Repository map

| File | Responsibility |
| --- | --- |
| [src/model.ts](../src/model.ts) | Queue transitions, focus accounting, daily summaries, deletion |
| [src/storage.ts](../src/storage.ts) | Restricted native storage client and browser adapter |
| [src-tauri/src/storage.rs](../src-tauri/src/storage.rs) | DPAPI, allowed storage targets, migration, atomic writes |
| [src/startup.ts](../src/startup.ts) | Startup-choice preferences and native registration calls |
| [src-tauri/src/startup.rs](../src-tauri/src/startup.rs) | Current-user Windows startup entry, quoted executable path |
| [src/windowMode.ts](../src/windowMode.ts) | Overlay geometry, monitor recovery, full-view restoration |
| [src/session.ts](../src/session.ts) / [native session listener](../src-tauri/src/session.rs) | Windows lock events and auto-pause |
| [src/App.tsx](../src/App.tsx) / [src/theme.css](../src/theme.css) | Queue, activity, dialogs, responsive layout |
| [PRIVACY.txt](../PRIVACY.txt) | Single privacy-notice source bundled into the app |
| [scripts](../scripts/) | Build, signing, tests, screenshots, icon generation |

Regenerate bundled icons with `scripts/Generate-Icon.ps1`. The unrelated original PriorityPanel project and its data are not modified or imported by this app.