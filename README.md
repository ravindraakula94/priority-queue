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
- A translucent, draggable 420 x 88 focus overlay with hover controls and one-click return to the full view.
- Windows screen-lock auto-pause in both views; unlocking never resumes the timer automatically.
- Automatic persistence, visible save failures, and single-instance protection.
- Compact dark interface, locally bundled fonts, and responsive layouts.

## Run on Windows

After a release build, double-click `src-tauri/target/release/priority-queue.exe`. The executable contains the frontend; Node, Rust, and .NET are not required to run it. Its data lives in your Windows profile, not next to the executable.

Alternatively, run the installer in `src-tauri/target/release/bundle/nsis/`. It installs for the current user and downloads Microsoft WebView2 if needed. Windows 10/11 machines usually already have WebView2. A standalone EXE requires WebView2 to be installed separately if absent.

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

Build just the standalone executable, without downloading installer tooling:

```powershell
.\scripts\Build-Windows.ps1 -NoBundle
```

The helper adds conventional Node and Cargo locations to its process PATH and reports output sizes. It does not install or modify system software. `npm run desktop:build` is also available when the toolchains are already on PATH. Icons can be regenerated with `scripts/Generate-Icon.ps1`.

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

Select the inward-arrow button beside the pin, or press Ctrl+Shift+M. On Windows, the same window becomes a small borderless, shadow-free strip, always on top, initially near the bottom-right corner of the current monitor's work area. The full view is unchanged apart from the new mode button.

Only the current task (or next queued task) and its time remain visible at rest. The background is translucent and becomes clearer on hover. Hover or use Tab to reveal pause/resume, complete-and-next, and expand controls. Drag the task title or timer to move the overlay. Long titles occupy at most two lines; hovering the title reveals the full text. The small strip captures pointer input so its controls remain usable; it is not click-through.

Completion in compact mode chooses the first remaining task in queue order. If tracking was running, it continues on the next task; if paused, the next task stays paused. An empty queue stops tracking. Switching modes alone never starts or stops the timer. Expand restores the prior window size, position, maximized state, and pin setting. The overlay position is remembered while the app remains open. Reopening still starts in full view with focus paused.

The browser can preview the compact UI, but desktop transparency, native window sizing/dragging, always-on-top, and Windows lock detection require the Windows executable.

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
```

Browser tests use installed Microsoft Edge and start or reuse the preview server. They cover task lifecycle, filters, exact timing, reload persistence, keyboard shortcuts, pointer/keyboard dragging, long text at 360px, and second-tab protection. Screenshots and failure traces are written to test output directories. To test another browser, change the Playwright channel.

The desktop smoke test requires a completed release build and no existing Priority Queue desktop instance. It opens the executable with a local WebView2 debugging port and routes test tasks to a temporary store. It verifies native controls, compact size/transparency, normal/maximized restoration, and lock auto-pause in both views, then closes its window and removes its temporary data. Lock/unlock notifications are sent only to the test process's hidden session-listener window; the test does not lock your workstation or alter real tasks. An actual Win+L smoke check remains useful on your Windows setup.

## Structure

- `src/model.ts`: typed queue transitions and focus/session accounting.
- `src/storage.ts`: desktop Store plugin and browser storage adapter.
- `src/windowMode.ts`: compact native window geometry and restoration.
- `src/session.ts` and `src-tauri/src/session.rs`: native Windows lock events and timer integration.
- `src/App.tsx`: queue, dialogs, focus controls, and activity views.
- `src/theme.css`: responsive dark utility styling.
- `src-tauri/`: small native host, permissions, and Windows packaging.
- `tests/`: browser workflows; `src/model.test.ts`: state-model tests.

Tray mode, global shortcuts, cloud sync, and import/export are not included in this version.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
