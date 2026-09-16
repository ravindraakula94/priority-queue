use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashSet, fs, io::Write, path::PathBuf, sync::Mutex};

const HEADER: &[u8] = b"PQDPAPI\x01";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DataFile {
    Queue,
    Preferences,
}

impl DataFile {
    fn filename(self) -> &'static str {
        match self {
            Self::Queue => "queue.json",
            Self::Preferences => "preferences.json",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PreferenceKey {
    StartupChoiceMade,
    OverlayGeometry,
}

impl PreferenceKey {
    fn name(self) -> &'static str {
        match self {
            Self::StartupChoiceMade => "startupChoiceMade",
            Self::OverlayGeometry => "overlayGeometry",
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    version: u32,
    kind: DataFile,
    data: Value,
}

pub struct SecureStorage {
    directory: PathBuf,
    lock: Mutex<()>,
}

impl SecureStorage {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory, lock: Mutex::new(()) }
    }

    pub fn read(&self, kind: DataFile) -> Result<Value, String> {
        let _guard = self.lock.lock().map_err(|_| "Storage lock failed.")?;
        self.read_locked(kind)
    }

    fn read_locked(&self, kind: DataFile) -> Result<Value, String> {
        let bytes = match fs::read(self.directory.join(kind.filename())) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(json!({})),
            Err(_) => return Err(format!("Could not read {}. Existing data was not changed.", kind.filename())),
        };
        if let Some(ciphertext) = bytes.strip_prefix(HEADER) {
            let plaintext = unprotect(ciphertext)?;
            let envelope: Envelope = serde_json::from_slice(&plaintext).map_err(|_| "Invalid encrypted app data.")?;
            if envelope.version != 1 || envelope.kind != kind {
                return Err("Unsupported or misplaced encrypted app data. Existing data was not changed.".into());
            }
            validate(kind, &envelope.data)?;
            return Ok(envelope.data);
        }
        let data: Value = serde_json::from_slice(&bytes).map_err(|_| "Unreadable app data. Existing data was not changed.")?;
        validate(kind, &data)?;
        self.write_locked(kind, &data)?;
        Ok(data)
    }

    pub fn save_queue(&self, queue: Value) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|_| "Storage lock failed.")?;
        let data = json!({ "queue": queue });
        validate(DataFile::Queue, &data)?;
        self.read_locked(DataFile::Queue)?;
        self.write_locked(DataFile::Queue, &data)
    }

    pub fn save_preference(&self, key: PreferenceKey, value: Value) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|_| "Storage lock failed.")?;
        let mut data = self.read_locked(DataFile::Preferences)?;
        data[key.name()] = value;
        validate(DataFile::Preferences, &data)?;
        self.write_locked(DataFile::Preferences, &data)
    }

    fn write_locked(&self, kind: DataFile, data: &Value) -> Result<(), String> {
        let plaintext = serde_json::to_vec(&Envelope { version: 1, kind, data: data.clone() })
            .map_err(|_| "Could not encode app data.")?;
        let ciphertext = protect(&plaintext)?;
        fs::create_dir_all(&self.directory).map_err(|_| "Could not create the app-data directory.")?;
        let mut temporary = tempfile::NamedTempFile::new_in(&self.directory).map_err(|_| "Could not create encrypted temporary file.")?;
        temporary.write_all(HEADER).and_then(|_| temporary.write_all(&ciphertext))
            .and_then(|_| temporary.as_file().sync_all()).map_err(|_| "Could not write encrypted app data.")?;
        temporary.persist(self.directory.join(kind.filename())).map_err(|_| "Could not replace app data. Previous data was not changed.")?;
        Ok(())
    }
}

fn validate(kind: DataFile, data: &Value) -> Result<(), String> {
    let object = data.as_object().ok_or("Invalid app data: expected an object.")?;
    match kind {
        DataFile::Queue => {
            if object.keys().any(|key| key != "queue") { return Err("Unrecognized queue format.".into()); }
            if let Some(queue) = object.get("queue").filter(|queue| !queue.is_null()) {
                if queue["version"] != 1 || !queue["tasks"].is_array() || !queue["sessions"].is_array() {
                    return Err("Unsupported saved queue. Existing data was not changed.".into());
                }
                let valid_time = |value: &Value| value.as_f64().is_some_and(|time| time.is_finite() && time >= 0.0);
                let mut ids = HashSet::new();
                for task in queue["tasks"].as_array().unwrap() {
                    let valid = task["id"].as_str().is_some_and(|id| ids.insert(id))
                        && task["title"].is_string()
                        && task["tags"].as_array().is_some_and(|tags| tags.iter().all(Value::is_string))
                        && task["due"].is_string()
                        && matches!(task["status"].as_str(), Some("queued" | "completed" | "archived"))
                        && valid_time(&task["createdAt"])
                        && (task["completedAt"].is_null() || valid_time(&task["completedAt"]));
                    if !valid { return Err("Invalid saved task. Existing data was not changed.".into()); }
                }
                for session in queue["sessions"].as_array().unwrap() {
                    let valid = session["taskId"].is_string() && session["title"].is_string()
                        && valid_time(&session["start"]) && valid_time(&session["end"])
                        && session["end"].as_f64() >= session["start"].as_f64();
                    if !valid { return Err("Invalid saved focus session. Existing data was not changed.".into()); }
                }
            }
        }
        DataFile::Preferences => {
            for (key, value) in object {
                match key.as_str() {
                    "startupChoiceMade" if value.is_boolean() => {}
                    "overlayGeometry" if value.is_object()
                        && ["x", "y", "width", "height"].iter().all(|field| value[field].as_f64().is_some_and(f64::is_finite))
                        && value["width"].as_f64().unwrap_or(0.0) >= 320.0
                        && value["height"].as_f64().unwrap_or(0.0) >= 88.0 => {}
                    _ => return Err("Invalid or unsupported app preference. Existing data was not changed.".into()),
                }
            }
        }
    }
    Ok(())
}

#[cfg(windows)]
fn crypt(input: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::{Foundation::LocalFree, Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN}};
    let length = u32::try_from(input.len()).map_err(|_| "App data is too large to encrypt.")?;
    let source = CRYPT_INTEGER_BLOB { cbData: length, pbData: input.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: null_mut() };
    unsafe {
        let result = if encrypt {
            CryptProtectData(&source, null(), null(), null(), null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output)
        } else {
            CryptUnprotectData(&source, null_mut(), null(), null(), null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output)
        };
        if result == 0 {
            return Err(if encrypt { "Windows could not encrypt app data." } else { "Windows could not decrypt app data. Use the original Windows account/profile; existing data was not changed." }.into());
        }
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        if !encrypt { std::ptr::write_bytes(output.pbData, 0, output.cbData as usize); }
        LocalFree(output.pbData.cast());
        Ok(bytes)
    }
}

fn protect(input: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    { crypt(input, true) }
    #[cfg(not(windows))]
    { let _ = input; Err("Encrypted desktop storage currently requires Windows.".into()) }
}

fn unprotect(input: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    { crypt(input, false) }
    #[cfg(not(windows))]
    { let _ = input; Err("Encrypted desktop storage currently requires Windows.".into()) }
}

#[tauri::command]
pub fn read_app_data(storage: tauri::State<'_, SecureStorage>, kind: DataFile) -> Result<Value, String> {
    storage.read(kind)
}

#[tauri::command]
pub fn save_queue_data(storage: tauri::State<'_, SecureStorage>, queue: Value) -> Result<(), String> {
    storage.save_queue(queue)
}

#[tauri::command]
pub fn save_app_preference(storage: tauri::State<'_, SecureStorage>, key: PreferenceKey, value: Value) -> Result<(), String> {
    storage.save_preference(key, value)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    fn queue() -> Value {
        json!({ "version": 1, "tasks": [{ "id": "task-1", "title": "Private task title", "tags": ["private"], "due": "", "status": "queued", "createdAt": 1, "completedAt": null }], "sessions": [{"taskId":"task-1", "title":"Private task title", "start":1, "end":2}], "focusId": "task-1", "runningSince": null })
    }

    #[test]
    fn encrypts_and_reopens_both_files() {
        let directory = tempfile::tempdir().unwrap();
        let storage = SecureStorage::new(directory.path().into());
        storage.save_queue(queue()).unwrap();
        storage.save_preference(PreferenceKey::StartupChoiceMade, json!(true)).unwrap();
        storage.save_preference(PreferenceKey::OverlayGeometry, json!({"x": -400, "y": 30, "width": 500, "height": 140})).unwrap();
        for kind in [DataFile::Queue, DataFile::Preferences] {
            let bytes = fs::read(directory.path().join(kind.filename())).unwrap();
            assert!(bytes.starts_with(HEADER));
            assert!(!bytes.windows(b"Private task title".len()).any(|part| part == b"Private task title"));
            assert!(serde_json::from_slice::<Value>(&bytes).is_err());
        }
        let reopened = SecureStorage::new(directory.path().into());
        assert_eq!(reopened.read(DataFile::Queue).unwrap()["queue"], queue());
        let preferences = reopened.read(DataFile::Preferences).unwrap();
        assert_eq!(preferences["startupChoiceMade"], true);
        assert_eq!(preferences["overlayGeometry"]["x"], -400);
    }

    #[test]
    fn migrates_plaintext_in_place_without_backup_files() {
        let directory = tempfile::tempdir().unwrap();
        let storage = SecureStorage::new(directory.path().into());
        for (kind, data) in [(DataFile::Queue, json!({"queue": queue()})), (DataFile::Preferences, json!({"startupChoiceMade": false}))] {
            let path = directory.path().join(kind.filename());
            fs::write(&path, serde_json::to_vec(&data).unwrap()).unwrap();
            assert_eq!(storage.read(kind).unwrap(), data);
            assert!(fs::read(path).unwrap().starts_with(HEADER));
        }
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
    }

    #[test]
    fn refuses_tampered_ciphertext_and_preserves_original() {
        let directory = tempfile::tempdir().unwrap();
        let storage = SecureStorage::new(directory.path().into());
        storage.save_queue(queue()).unwrap();
        let path = directory.path().join("queue.json");
        let mut bytes = fs::read(&path).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        fs::write(&path, &bytes).unwrap();
        assert!(storage.read(DataFile::Queue).is_err());
        assert!(storage.save_queue(queue()).is_err());
        assert_eq!(fs::read(path).unwrap(), bytes);
    }

    #[test]
    fn refuses_corrupt_or_future_plaintext_without_overwriting() {
        let directory = tempfile::tempdir().unwrap();
        let storage = SecureStorage::new(directory.path().into());
        let path = directory.path().join("queue.json");
        for bytes in [b"not json".as_slice(), br#"{"queue":{"version":2,"tasks":[],"sessions":[]}}"#, br#"{"queue":{"version":1,"tasks":[{}],"sessions":[]}}"#] {
            fs::write(&path, bytes).unwrap();
            assert!(storage.read(DataFile::Queue).is_err());
            assert!(storage.save_queue(queue()).is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
    }

    #[test]
    fn rejects_swapped_files_and_unknown_targets() {
        for target in ["../queue.json", "C:\\outside.json", "queue.json", "other"] {
            assert!(serde_json::from_value::<DataFile>(json!(target)).is_err());
            assert!(serde_json::from_value::<PreferenceKey>(json!(target)).is_err());
        }
        let directory = tempfile::tempdir().unwrap();
        let storage = SecureStorage::new(directory.path().into());
        storage.save_queue(queue()).unwrap();
        fs::copy(directory.path().join("queue.json"), directory.path().join("preferences.json")).unwrap();
        assert!(storage.read(DataFile::Preferences).is_err());
    }

    #[test]
    fn rejects_future_encrypted_format_without_overwriting() {
        let directory = tempfile::tempdir().unwrap();
        let storage = SecureStorage::new(directory.path().into());
        let mut bytes = HEADER.to_vec();
        bytes.extend(protect(&serde_json::to_vec(&Envelope { version: 2, kind: DataFile::Queue, data: json!({"queue": queue()}) }).unwrap()).unwrap());
        let path = directory.path().join("queue.json");
        fs::write(&path, &bytes).unwrap();
        assert!(storage.read(DataFile::Queue).is_err());
        assert!(storage.save_queue(queue()).is_err());
        assert_eq!(fs::read(path).unwrap(), bytes);
    }

    #[test]
    fn concurrent_preference_updates_preserve_both_keys() {
        let directory = tempfile::tempdir().unwrap();
        let storage = std::sync::Arc::new(SecureStorage::new(directory.path().into()));
        let startup_storage = storage.clone();
        let startup = std::thread::spawn(move || startup_storage.save_preference(PreferenceKey::StartupChoiceMade, json!(true)).unwrap());
        let geometry_storage = storage.clone();
        let geometry = std::thread::spawn(move || geometry_storage.save_preference(PreferenceKey::OverlayGeometry, json!({"x":0,"y":0,"width":420,"height":88})).unwrap());
        startup.join().unwrap();
        geometry.join().unwrap();
        let preferences = storage.read(DataFile::Preferences).unwrap();
        assert_eq!(preferences["startupChoiceMade"], true);
        assert_eq!(preferences["overlayGeometry"]["width"], 420);
        assert!(storage.save_preference(PreferenceKey::StartupChoiceMade, json!("invalid")).is_err());
        assert_eq!(storage.read(DataFile::Preferences).unwrap(), preferences);
    }

    #[test]
    fn failed_replacement_keeps_previous_data_and_cleans_tempfile() {
        let directory = tempfile::tempdir().unwrap();
        let storage = SecureStorage::new(directory.path().into());
        storage.save_queue(queue()).unwrap();
        let path = directory.path().join("queue.json");
        let before = fs::read(&path).unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&path, permissions.clone()).unwrap();
        assert!(storage.save_queue(json!({"version":1,"tasks":[],"sessions":[]})).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
        permissions.set_readonly(false);
        fs::set_permissions(path, permissions).unwrap();
    }
}