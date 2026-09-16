# Priority Queue

A compact, local-first Windows focus companion. Built with Tauri 2, React, TypeScript, and Vite. The original PriorityPanel folder is independent and unchanged.

## Features

- Ordered task queue with mouse, touch, keyboard, and menu-based reordering.
- One focused task at a time; start, pause, resume, or switch explicitly.
- Full-view completion stops its timer. Compact-view completion loads the next queued task and continues only if the previous task was running.
- Edit titles, comma-separated tags, and due dates; search and filter the list.
- Complete, archive, restore, and permanently delete tasks with their focus history, with confirmation before deletion.
- Daily focus totals, completion counts, a seven-day chart, and per-task breakdown.
- Always-on-top desktop window with a pin toggle and standard Windows controls.
- Starts in a translucent, draggable, resizable focus overlay (420 x 88 by default), with saved placement, hover controls, and one-click return to the full view.
- Optional Windows sign-in startup, offered on first launch and editable in Settings.
- Windows screen-lock auto-pause in both views; unlocking never resumes the timer automatically.
- Automatic persistence, visible save failures, and single-instance protection.
- Windows account-bound encryption for tasks, focus history, and app preferences, with restricted native storage commands.
- Bundled offline privacy notice and explicit cleanup of retained history from previously deleted tasks.
- Compact dark interface, locally bundled fonts, and responsive layouts.

## Run on Windows

Download the `Priority Queue_<version>_x64-setup.exe` installer from GitHub Releases and run it. New releases distribute the installer, not the standalone executable. Local builds produce it under `src-tauri/target/release/bundle/nsis/`.

The installer installs for the current user without administrator access, creates a Start menu entry, and downloads Microsoft WebView2 if needed. Node, Rust, and .NET are not required to run the app. Task data remains in your Windows profile, separate from the installation.

On first launch, select **Start with Windows** and choose **Continue** to enable automatic launch after signing in. Leave it unchecked and continue to keep automatic startup off. **Not now** postpones the choice until the next launch. After this choice, the app opens in mini translucent mode with its timer paused. Expand the app and open **Settings** to change the startup option later.

Startup applies to your Windows account at sign-in, not before login. The app does not repeatedly register itself or override an opt-out. Windows Startup Apps or organizational policy can also block startup; the app setting reflects its registration, not a policy override.

Uninstall through Windows **Settings > Apps > Installed apps**. The uninstaller removes the startup entry. Task data is retained unless you explicitly select the uninstaller's option to delete app data. Installing over a previous standalone copy uses the same task-data location; close the old copy and launch the installed app afterward.

The published v0.2.0 installer is unsigned. Local builds can optionally be self-signed as described below; self-signing does not establish a publicly trusted publisher or guarantee removal of Windows SmartScreen warnings. Verify the source/build before running. Public distribution should use a trusted code-signing certificate or approved signing service.

## Development

Prerequisites: a supported Node.js release (Node 22 LTS recommended), npm, Rust stable, and the Visual Studio C++ build tools with the Windows SDK. No .NET SDK is needed.

From this folder:

```powershell
npm install
npm run dev
```

Browser preview: http://127.0.0.1:1421. The browser uses its own unencrypted local storage, separate from desktop data; it is a development preview, not the encrypted Windows app. The port is deliberately different from the old app's 1420. Override it with `npm run dev -- --port 1422` if necessary; desktop development requires a matching `devUrl` in the Tauri configuration.

```powershell
npm run desktop:dev
```

## Build

```powershell
.\scripts\Build-Windows.ps1
```

For a local release executable without installer packaging:

```powershell
.\scripts\Build-Windows.ps1 -NoBundle
```

Native smoke tests use `npm run desktop:test-build` instead, so their data directory can be isolated in a debug build. Never distribute this debug executable.

The helper adds conventional Node and Cargo locations to its process PATH and reports the installer path, size, and SHA-256 hash. It does not install or modify system software. `npm run desktop:build` is also available when the toolchains are already on PATH. Icons can be regenerated with `scripts/Generate-Icon.ps1`.

### Self-Signed Builds

On the Windows build machine, use PowerShell 7 and the Windows SDK signing tools:

```powershell
.\scripts\Initialize-SelfSigning.ps1
.\scripts\Build-Windows.ps1 -SelfSign
```

Setup creates a two-year, SHA-256/RSA-3072 code-signing certificate named `Priority Queue (Self-Signed)` in `Cert:\CurrentUser\My`. Its private key is a non-exportable Windows CNG software key, kept outside the repository. Running setup again reuses the configured certificate rather than silently changing the signing identity. Setup does not add the certificate to Trusted Root or Trusted Publishers, and does not require administrator access.

The local, ignored `.signing/` directory contains a Tauri signing override and `PriorityQueue-SelfSigned.cer`, which contains only the public certificate. Do not commit signing configuration, export private keys into the repository, or share private-key containers. The public `.cer` may be shared with testers; publish its SHA-256 fingerprint through a channel they already trust before asking them to trust it. Windows trust-store changes are a separate, explicit decision, not part of installation or these scripts. Self-signing asserts this project's identity; no certificate authority has verified it.

`-SelfSign` makes Tauri sign the app inside the installer, the uninstaller, and the setup executable. SignTool obtains an RFC 3161 timestamp from `timestamp.digicert.com`, so signing needs network access. This timestamp request is build-time activity, not app telemetry. The build checks the signer and timestamp and reports the final installer hash. A chain ending in an untrusted root is expected on machines that have not explicitly trusted this certificate; it must not be confused with a missing signature or modified file. Tauri restores the unsigned intermediate `target/release/priority-queue.exe` after packaging, so inspect the installed or extracted app when verifying the bundled signature.

With 7-Zip installed, verify all three signatures without installing or trusting anything:

```powershell
.\scripts\Test-SelfSigning.ps1
```

This extracts the installer into a temporary folder, checks the certificate and timestamp on the installer, app, and uninstaller, and verifies that modifying a temporary app copy produces `HashMismatch`. Supply `-SevenZip` if 7-Zip is not in its conventional install directory. The temporary files are removed afterward.

`Build-Windows.ps1 -NoBundle -SelfSign` signs the standalone development artifact instead. Normal builds without `-SelfSign` remain unsigned. The certificate/key are tied to this Windows profile; loss of the profile or key requires a new signing identity. Renew explicitly before expiry. A trusted timestamp records when signing occurred, but does not make the self-signed identity trusted.

Signing changes file hashes. Never overwrite an existing published release with differently signed files under the same version. Bump the version, build, verify, and publish a new release. Setting up local self-signing does not alter the existing GitHub release.

### Publishing

For each release, update the version consistently in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and the lockfiles. Run validation, build with `Build-Windows.ps1` without `-NoBundle` (add `-SelfSign` for local self-signing), and upload the matching `*-setup.exe` and `LICENSE` to the GitHub release. For a self-signed release, disclose its trust limitations and optionally include the public `.cer` with its independently verifiable fingerprint. Include the final installer's SHA-256 hash in the release notes. The executable under `target/release/` is an internal build artifact, not a release download.

For in-place upgrades that preserve startup registration, use the installer's update mode, for example `& '.\Priority Queue_<version>_x64-setup.exe' /UPDATE`. A full uninstall followed by reinstall removes startup registration; re-enable it in Settings afterward if needed.

## Keyboard Shortcuts

Shortcuts apply while the app has focus, not globally across Windows.

| Shortcut | Action |
| --- | --- |
| Ctrl+K | New task |
| Ctrl+F | Search the current task view |
| Ctrl+Shift+Space | Start or pause focus |
| Ctrl+Shift+Enter | Complete the focused task |
| Ctrl+Shift+M | Switch between full view and compact overlay |
| Escape | Close a dialog or task menu |
| Space, arrow keys, Space | Pick up, reorder, and drop a focused drag handle |

## Compact Overlay

After the first-launch startup choice, the Windows app opens automatically in the compact overlay: a small borderless, shadow-free strip, always on top, initially near the bottom-right corner of the current monitor's work area. Hover and select Expand to full view, or press Ctrl+Shift+M, to open the full queue. Select the inward-arrow button beside the pin or use the same shortcut to return to the overlay.

Only the current task (or next queued task) and its time remain visible at rest. The background is translucent and becomes clearer on hover. Hover or use Tab to reveal pause/resume, complete-and-next, and expand controls. Drag the task title or timer to move the overlay; drag a window edge or corner to resize it (minimum 320 x 88). Long titles occupy at most two lines; hovering the title reveals the full text. The small strip captures pointer input so its controls remain usable; it is not click-through.

Completion in compact mode chooses the first remaining task in queue order. If tracking was running, it continues on the next task; if paused, the next task stays paused. An empty queue stops tracking. Switching modes alone never starts or stops the timer. Expand restores the prior full-window size, position, maximized state, and pin setting.

The overlay's size and position are saved automatically to `preferences.json` in the app-data directory after moving or resizing, before expanding, and on normal close. Reopening restores that geometry with focus paused, even if the app was closed in full view. Size is stored in logical pixels for display scaling. If the saved monitor is unavailable or its work area is smaller, the overlay is fitted into an available monitor's visible work area. Bottom-right placement is only the initial default; full-window geometry is kept separately during the session.

The browser preview still starts in full view and can switch to the compact UI, but desktop transparency, native window sizing/dragging, always-on-top, and Windows lock detection require the Windows executable.

## Data and Timing

Desktop data lives in `queue.json` and `preferences.json` under Tauri's application-data directory, normally `%APPDATA%\com.priorityqueue.desktop`. Despite their legacy filenames, these files now contain encrypted binary data, not readable JSON. The app has no task-data upload or cloud-sync service. WebView2 has its own Microsoft-managed diagnostics and update behavior.

### Encryption and Migration

Windows DPAPI encrypts and integrity-protects the queue, historical task titles and timing, startup-choice preference, and overlay geometry for the current Windows user. There is no application password, hard-coded key, or separate plaintext key file. The frontend can only read the two named datasets, save the queue, and update the two allowed preference keys. It cannot supply storage paths; the general-purpose Store plugin has been removed, and the native commands are granted only to the main local window.

Valid plaintext files from earlier Priority Queue versions migrate automatically on their first read. Migration atomically replaces each file with ciphertext at the same path, preserving its data. Temporary writes contain ciphertext only; the app does not leave plaintext backup files. Unreadable, tampered, unsupported, or undecryptable files produce errors and are not replaced with empty data. The unrelated original PriorityPanel app is not imported.

**Do not downgrade to v0.2.0 or earlier after migration:** those versions cannot read the encrypted format and may overwrite it. Encryption is transparent on subsequent launches of the updated app.

DPAPI protects data at rest, not against software running as the same Windows user, administrators with sufficient access, or a compromised app process. Data is necessarily decrypted in memory while the app runs. The startup registry entry still contains the executable path, as Windows requires. Encryption and deletion do not securely erase old filesystem blocks, OS backups, crash dumps, or copies made before migration.

**Recovery:** keep backups together with a recoverable Windows profile. Copying just these files to another account or a reinstalled Windows system is not a supported recovery method; losing the profile's DPAPI keys can make the data unrecoverable. There is no portable export/recovery-key feature yet. Protect any pre-migration backups separately. Browser preview storage is not encrypted, and encrypted native storage currently requires Windows.

Changes save immediately. A running timer checkpoints every five seconds, and normal desktop close waits for a final save. Reopening restores the focused task paused and never charges time while the app was closed. A forced termination can lose time since the last checkpoint. Minimized or background windows keep tracking; switching to another app does not pause focus. Windows session-lock notifications pause at the native lock timestamp, including when the webview handles the event late. Unlocking leaves the task paused until you explicitly resume. Sleep without a session lock still counts as elapsed time, so pause before suspending an unlocked machine. Time is calculated from timestamps, not accumulated interval ticks.

Daily totals use local calendar-day boundaries, including sessions crossing midnight. Deleting a task permanently removes that task and every associated focus session, historical title, and timestamp from the active saved dataset. Its focus time and completion count disappear from activity summaries; other tasks and their history remain. Completing or archiving a task still retains its history. Restoring a task clears its completed status/date. A second desktop instance focuses the first; browser tabs use an exclusive Web Lock to avoid concurrent writes.

Unreadable or incompatible stored data shows an error and is not silently replaced. Save failures leave the app open and expose a retry action. Do not manually edit encrypted data files.

## Privacy and Deletion

Read the [Privacy notice](PRIVACY.txt), also bundled into the app and available offline from **Privacy** in the full-view footer or **Privacy notice** in welcome/settings. It covers local data, encryption limitations, retention, Microsoft WebView2 diagnostics and crash reporting, installer/runtime network activity, and Windows diagnostic controls. Opening the notice itself does not make a network request.

Task deletion requires confirmation and has no undo. Removal from disk is complete only after a successful save; retry any reported save failure. This is deletion from the current app dataset, not forensic secure erasure of backups or old disk contents.

Older versions retained sessions for deleted tasks. To remove these, open **Privacy**, select **Delete retained history**, and confirm. This only removes sessions whose task no longer exists; it does not erase history for queued, completed, or archived tasks. Existing retained history is not silently purged on upgrade. Uninstallation retains app data unless its delete-app-data option is selected.

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
npm run test:installer
```

Browser tests use installed Microsoft Edge and start or reuse the preview server. They cover task lifecycle, permanent task/history deletion, confirmed legacy cleanup and save retry, offline privacy access, filters, exact timing, reload persistence, keyboard shortcuts, pointer/keyboard dragging, long text at 360px, and second-tab protection. Screenshots and failure traces are written to test output directories. To test another browser, change the Playwright channel.

The Rust storage tests exercise DPAPI round trips, plaintext migration, tampered and future-format rejection, failed atomic replacement, concurrent preference updates, and fixed storage targets. The desktop smoke test requires `npm run desktop:test-build` and no running Priority Queue. It uses `PRIORITY_QUEUE_TEST_DATA_DIR`, recognized only in debug builds, to isolate data before startup or migration. Release builds always use the normal app-data directory and ignore that variable. The smoke test verifies ciphertext on disk, denied arbitrary targets and old Store commands, corruption handling, startup settings, overlay restart persistence, transparency, and lock auto-pause. It restores startup registry changes and checks that normal task/preference files are unchanged. It does not lock your workstation.

The installer smoke test requires PowerShell 7, a built installer and matching release executable, and no existing installed/running Priority Queue (use a clean Windows test profile otherwise). It installs into a temporary directory, verifies the installed executable's hash, checks update-mode startup preservation and normal uninstall cleanup, and verifies normal task/preference files are unchanged. It does not launch the installed copy, avoiding unintended migration of real data; run the isolated desktop checks separately. It restores the original startup and installer-location registry values. Do not interrupt these tests while they are restoring state.

## Structure

- `src/model.ts`: typed queue transitions and focus/session accounting.
- `src/storage.ts`: restricted native storage client and browser preview adapter.
- `src-tauri/src/storage.rs`: fixed storage targets, Windows DPAPI encryption, atomic writes, and plaintext migration.
- `src/startup.ts`: Windows startup registration and first-launch preference.
- `src/windowMode.ts`: compact native window geometry and restoration.
- `src/session.ts` and `src-tauri/src/session.rs`: native Windows lock events and timer integration.
- `src/App.tsx`: queue, dialogs, focus controls, and activity views.
- `PRIVACY.txt`: shared privacy notice, bundled as text for offline in-app access.
- `src/theme.css`: responsive dark utility styling.
- `src-tauri/`: small native host, permissions, and Windows packaging.
- `tests/`: browser workflows; `src/model.test.ts`: state-model tests.

Tray mode, global shortcuts, cloud sync, and import/export are not included in this version.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
