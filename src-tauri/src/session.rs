use serde::Serialize;
use std::sync::Mutex;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    locked: bool,
    last_lock: u64,
}

static SESSION: Mutex<SessionState> = Mutex::new(SessionState { locked: false, last_lock: 0 });

#[tauri::command]
pub fn get_session_state() -> Result<SessionState, String> {
    SESSION.lock().map(|state| *state).map_err(|error| error.to_string())
}

#[cfg(windows)]
mod windows {
    use super::SESSION;
    use std::{io, ptr::null_mut, sync::{atomic::{AtomicIsize, Ordering}, mpsc, OnceLock}, time::{Duration, SystemTime, UNIX_EPOCH}};
    use tauri::Emitter;
    use windows_sys::{core::w, Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        System::{LibraryLoader::GetModuleHandleW, RemoteDesktop::{WTSRegisterSessionNotification, WTSUnRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION}},
        UI::WindowsAndMessaging::{CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW, PostMessageW, PostQuitMessage, RegisterClassW, TranslateMessage, MSG, WM_CLOSE, WM_DESTROY, WM_WTSSESSION_CHANGE, WNDCLASSW, WTS_SESSION_LOCK, WTS_SESSION_UNLOCK},
    }};

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
    static MONITOR: AtomicIsize = AtomicIsize::new(0);

    unsafe extern "system" fn window_proc(window: HWND, message: u32, parameter: WPARAM, detail: LPARAM) -> LRESULT {
        match message {
            WM_WTSSESSION_CHANGE if parameter == WTS_SESSION_LOCK as usize || parameter == WTS_SESSION_UNLOCK as usize => {
                if let Ok(mut state) = SESSION.lock() {
                    let locked = parameter == WTS_SESSION_LOCK as usize;
                    if locked && !state.locked {
                        state.last_lock = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
                    }
                    state.locked = locked;
                    let snapshot = *state;
                    drop(state);
                    if let Some(app) = APP.get() {
                        let _ = app.emit_to("main", "session-state", snapshot);
                    }
                }
                0
            }
            WM_CLOSE => {
                DestroyWindow(window);
                0
            }
            WM_DESTROY => {
                WTSUnRegisterSessionNotification(window);
                MONITOR.store(0, Ordering::SeqCst);
                PostQuitMessage(0);
                0
            }
            _ => DefWindowProcW(window, message, parameter, detail),
        }
    }

    pub fn start(app: tauri::AppHandle) -> io::Result<()> {
        APP.set(app).map_err(|_| io::Error::other("Session monitor is already initialized"))?;
        let (ready, receiver) = mpsc::sync_channel(1);
        std::thread::Builder::new().name("windows-session-monitor".into()).spawn(move || unsafe {
            let instance = GetModuleHandleW(std::ptr::null());
            let class = WNDCLASSW { lpfnWndProc: Some(window_proc), hInstance: instance, lpszClassName: w!("PriorityQueueSessionMonitor"), ..Default::default() };
            if RegisterClassW(&class) == 0 {
                let _ = ready.send(Err(io::Error::last_os_error()));
                return;
            }
            let title: Vec<u16> = format!("PriorityQueueSessionMonitor-{}", std::process::id()).encode_utf16().chain(Some(0)).collect();
            let window = CreateWindowExW(0, class.lpszClassName, title.as_ptr(), 0, 0, 0, 0, 0, null_mut(), null_mut(), instance, std::ptr::null());
            if window.is_null() {
                let _ = ready.send(Err(io::Error::last_os_error()));
                return;
            }
            if WTSRegisterSessionNotification(window, NOTIFY_FOR_THIS_SESSION) == 0 {
                let error = io::Error::last_os_error();
                DestroyWindow(window);
                let _ = ready.send(Err(error));
                return;
            }
            MONITOR.store(window as isize, Ordering::SeqCst);
            let _ = ready.send(Ok(()));
            let mut message = MSG::default();
            while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        })?;
        receiver.recv_timeout(Duration::from_secs(5)).map_err(io::Error::other)?
    }

    pub fn stop() {
        let window = MONITOR.load(Ordering::SeqCst);
        if window != 0 {
            unsafe { PostMessageW(window as HWND, WM_CLOSE, 0, 0); }
        }
    }
}

#[cfg(windows)]
pub use windows::{start, stop};

#[cfg(not(windows))]
pub fn start(_: tauri::AppHandle) -> std::io::Result<()> { Ok(()) }

#[cfg(not(windows))]
pub fn stop() {}