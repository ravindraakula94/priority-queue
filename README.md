# Priority Queue

A compact, local-first Windows focus companion. Built with Tauri 2, React, TypeScript, and Vite. The original PriorityPanel folder is independent and unchanged.

## Features

- Ordered task queue with mouse, touch, keyboard, and menu-based reordering.
- One focused task at a time; start, pause, resume, or switch explicitly.
- Full-view completion stops its timer. Compact-view completion loads the next queued task and continues only if the previous task was running.
- Edit titles, comma-separated tags, and due dates; search and filter the list.
- Complete, archive, restore, and delete tasks, with confirmation before deletion.
- Daily focus totals, completion counts, a seven-day chart, and per-task breakdown.
- Always-on-top desktop window with a pin toggle and standard Windows controls.
- Starts in a translucent, draggable, resizable focus overlay (420 x 88 by default), with saved placement, hover controls, and one-click return to the full view.
- Optional Windows sign-in startup, offered on first launch and editable in Settings.
- Windows screen-lock auto-pause in both views; unlocking never resumes the timer automatically.
- Automatic persistence, visible save failures, and single-instance protection.
- Compact dark interface, locally bundled fonts, and responsive layouts.

## Run on Windows

Download the `Priority Queue_<version>_x64-setup.exe` installer from GitHub Releases and run it. New releases distribute the installer, not the standalone executable. Local builds produce it under `src-tauri/target/release/bundle/nsis/`.

The installer installs for the current user without administrator access, creates a Start menu entry, and downloads Microsoft WebView2 if needed. Node, Rust, and .NET are not required to run the app. Task data remains in your Windows profile, separate from the installation.

On first launch, select **Start with Windows** and choose **Continue** to enable automatic launch after signing in. Leave it unchecked and continue to keep automatic startup off. **Not now** postpones the choice until the next launch. After this choice, the app opens in mini translucent mode with its timer paused. Expand the app and open **Settings** to change the startup option later.

Startup applies to your Windows account at sign-in, not before login. The app does not repeatedly register itself or override an opt-out. Windows Startup Apps or organizational policy can also block startup; the app setting reflects its registration, not a policy override.

Uninstall through Windows **Settings > Apps > Installed apps**. The uninstaller removes the startup entry. Task data is retained unless you explicitly select the uninstaller's option to delete app data. Installing over a previous standalone copy uses the same task-data location; close the old copy and launch the installed app afterward.

The release is unsigned, so Windows SmartScreen may warn about an unrecognized publisher. Verify the source/build before running; production distribution should use a code-signing certificate.

## Development

Prerequisites: a supported Node.js release (Node 22 LTS recommended), npm, Rust stable, and the Visual Studio C++ build tools with the Windows SDK. No .NET SDK is needed.

From this folder:

```powershell
npm install
npm run dev
```

Browser preview: http://127.0.0.1:1421. The browser uses its own local storage, separate from desktop data. The port is deliberately different from the old app's 1420. Override it with `npm run dev -- --port 1422` if necessary; desktop development requires a matching `devUrl` in the Tauri configuration.

```powershell
npm run desktop:dev
```

## Build

```powershell
.\scripts\Build-Windows.ps1
```

For local development or native smoke tests only, skip installer packaging:

```powershell
.\scripts\Build-Windows.ps1 -NoBundle
```

The helper adds conventional Node and Cargo locations to its process PATH and reports the installer path, size, and SHA-256 hash. It does not install or modify system software. `npm run desktop:build` is also available when the toolchains are already on PATH. Icons can be regenerated with `scripts/Generate-Icon.ps1`.

### Publishing

For each release, update the version consistently in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and the lockfiles. Run validation, build with `Build-Windows.ps1` without `-NoBundle`, and upload only the matching `*-setup.exe` and `LICENSE` to the GitHub release. Include the installer's SHA-256 hash in the release notes. The executable under `target/release/` is an internal build artifact, not a release download.

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

Desktop data is stored in `queue.json` under Tauri's application-data directory, normally `%APPDATA%\com.priorityqueue.desktop\queue.json`. The file contains a versioned queue and focus sessions. No remote API, account, telemetry, or synchronization is configured. The old app's data is not automatically imported.

Changes save immediately. A running timer checkpoints every five seconds, and normal desktop close waits for a final save. Reopening restores the focused task paused and never charges time while the app was closed. A forced termination can lose time since the last checkpoint. Minimized or background windows keep tracking; switching to another app does not pause focus. Windows session-lock notifications pause at the native lock timestamp, including when the webview handles the event late. Unlocking leaves the task paused until you explicitly resume. Sleep without a session lock still counts as elapsed time, so pause before suspending an unlocked machine. Time is calculated from timestamps, not accumulated interval ticks.

Daily totals use local calendar-day boundaries, including sessions crossing midnight. Deleting a task preserves its focus-session history, but removes its completion count. Restoring a task clears its completed status/date. A second desktop instance focuses the first; browser tabs use an exclusive Web Lock to avoid concurrent writes.

Unreadable or incompatible stored data shows an error and is not silently replaced. Save failures leave the app open and expose a retry action. Back up the data file before making manual changes.

## Validation

```powershell
npm test
npm run test:e2e
npm run build
npm run lint
cargo check --manifest-path src-tauri/Cargo.toml
npm run test:desktop
npm run test:installer
```

Browser tests use installed Microsoft Edge and start or reuse the preview server. They cover task lifecycle, filters, exact timing, reload persistence, keyboard shortcuts, pointer/keyboard dragging, long text at 360px, and second-tab protection. Screenshots and failure traces are written to test output directories. To test another browser, change the Playwright channel.

The desktop smoke test requires a completed release build and no existing Priority Queue desktop instance. It opens the executable with a local WebView2 debugging port and redirects storage IPC to temporary task and preference files before test actions. It verifies first-launch opt-in/opt-out, startup persistence, settings failures/retry, saved overlay geometry across view changes and app restart, off-screen/invalid geometry recovery, transparency, full-window restoration, and lock auto-pause. Its temporary startup changes are restored in a `finally` block. Lock/unlock notifications target only the test process; the test does not lock your workstation. An actual sign-out/sign-in and Win+L check remains useful on your Windows setup.

The installer smoke test requires PowerShell 7, a built installer, and no existing installed/running Priority Queue (use a clean Windows test profile otherwise). It installs into a temporary directory, runs the desktop checks against the installed copy, checks update-mode startup preservation and normal uninstall cleanup, and verifies existing task and preference files are unchanged. It restores the original startup and installer-location registry values. Do not interrupt these tests while they are restoring state.

## Structure

- `src/model.ts`: typed queue transitions and focus/session accounting.
- `src/storage.ts`: desktop Store plugin and browser storage adapter.
- `src/startup.ts`: Windows startup registration and first-launch preference.
- `src/windowMode.ts`: compact native window geometry and restoration.
- `src/session.ts` and `src-tauri/src/session.rs`: native Windows lock events and timer integration.
- `src/App.tsx`: queue, dialogs, focus controls, and activity views.
- `src/theme.css`: responsive dark utility styling.
- `src-tauri/`: small native host, permissions, and Windows packaging.
- `tests/`: browser workflows; `src/model.test.ts`: state-model tests.

Tray mode, global shortcuts, cloud sync, and import/export are not included in this version.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
