use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::VecDeque;
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const DEEPSEEK_ENDPOINT: &str = "https://api.deepseek.com/chat/completions";
const KEYRING_SERVICE: &str = "com.deepwrite.desktop";
const KEYRING_USER: &str = "stronghold-master-password";

#[derive(Default)]
pub struct PendingOpenDocuments {
    queue: Mutex<VecDeque<String>>,
}

impl PendingOpenDocuments {
    pub(crate) fn push(&self, path: String) -> Result<(), String> {
        self.queue
            .lock()
            .map_err(|_| "待打开文档队列不可用".to_string())?
            .push_back(path);
        Ok(())
    }

    fn drain(&self) -> Result<Vec<String>, String> {
        let mut queue = self
            .queue
            .lock()
            .map_err(|_| "待打开文档队列不可用".to_string())?;
        Ok(queue.drain(..).collect())
    }
}

fn safe_error(context: &str, error: impl std::fmt::Display) -> String {
    let detail = error.to_string();
    let trimmed: String = detail.chars().take(300).collect();
    format!("{context}: {trimmed}")
}

fn save_conflict(detail: &str) -> String {
    format!("保存冲突：{detail}")
}

#[cfg(windows)]
fn replace_file(temp: &Path, destination: &Path, replace_existing: bool) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let flags = MOVEFILE_WRITE_THROUGH
        | if replace_existing {
            MOVEFILE_REPLACE_EXISTING
        } else {
            0
        };
    let ok = unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), flags) };
    if ok == 0 {
        Err(safe_error(
            "无法安全替换文件",
            std::io::Error::last_os_error(),
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(temp: &Path, destination: &Path, replace_existing: bool) -> Result<(), String> {
    if !replace_existing && destination.exists() {
        return Err(safe_error(
            "无法安全替换文件",
            std::io::Error::new(std::io::ErrorKind::AlreadyExists, "目标文件已经存在"),
        ));
    }
    fs::rename(temp, destination).map_err(|e| safe_error("无法安全替换文件", e))
}

fn prepare_temp_file(path: &Path, data: &[u8]) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "目标路径没有父目录".to_string())?;
    fs::create_dir_all(parent).map_err(|e| safe_error("无法创建目录", e))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "目标文件名无效".to_string())?;
    let temp = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = File::create(&temp).map_err(|e| safe_error("无法创建临时文件", e))?;
        file.write_all(data)
            .map_err(|e| safe_error("无法写入临时文件", e))?;
        file.sync_all()
            .map_err(|e| safe_error("无法同步临时文件", e))?;
        Ok::<(), String>(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
        result?;
    }
    Ok(temp)
}

fn atomic_write(path: PathBuf, data: &[u8]) -> Result<(), String> {
    let temp = prepare_temp_file(&path, data)?;
    let result = replace_file(&temp, &path, true);
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(windows)]
struct SaveMutex {
    handle: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
impl SaveMutex {
    fn acquire(path: &Path) -> Result<Self, String> {
        use std::collections::hash_map::DefaultHasher;
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{CreateMutexW, WaitForSingleObject};

        let mut hasher = DefaultHasher::new();
        path.to_string_lossy().to_lowercase().hash(&mut hasher);
        let name = format!("Local\\DeepWriteSave-{:016x}", hasher.finish());
        let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, wide.as_ptr()) };
        if handle.is_null() {
            return Err(safe_error(
                "无法创建文档保存互斥锁",
                std::io::Error::last_os_error(),
            ));
        }
        let wait = unsafe { WaitForSingleObject(handle, u32::MAX) };
        if wait != 0 && wait != 0x0000_0080 {
            unsafe { CloseHandle(handle) };
            return Err(safe_error(
                "无法等待文档保存互斥锁",
                std::io::Error::last_os_error(),
            ));
        }
        Ok(Self { handle })
    }
}

#[cfg(windows)]
impl Drop for SaveMutex {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::ReleaseMutex;
        unsafe {
            ReleaseMutex(self.handle);
            CloseHandle(self.handle);
        }
    }
}

#[cfg(not(windows))]
struct SaveMutex;

#[cfg(not(windows))]
impl SaveMutex {
    fn acquire(_path: &Path) -> Result<Self, String> {
        Ok(Self)
    }
}

fn compare_and_swap_text_path(
    path: PathBuf,
    expected_contents: Option<&str>,
    contents: &str,
) -> Result<(), String> {
    let temp = prepare_temp_file(&path, contents.as_bytes())?;
    let result = (|| {
        let _guard = SaveMutex::acquire(&path)?;
        if let Some(expected) = expected_contents {
            let current = match fs::read_to_string(&path) {
                Ok(value) => value,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return Err(save_conflict(
                        "磁盘文件已被删除或移动，请重新打开或另存为。",
                    ));
                }
                Err(error) => return Err(safe_error("无法读取目标文件进行冲突检查", error)),
            };
            if current != expected {
                return Err(save_conflict(
                    "磁盘文件自上次读取后已被其他实例或程序修改；DeepWrite 未覆盖这些外部修改。",
                ));
            }
            return replace_file(&temp, &path, true);
        }

        if path.exists() {
            return Err(save_conflict(
                "目标文件在保存前已被创建或替换，请重新选择保存位置。",
            ));
        }
        match replace_file(&temp, &path, false) {
            Ok(()) => Ok(()),
            Err(_) if path.exists() => Err(save_conflict(
                "目标文件在保存过程中已被其他实例或程序创建；DeepWrite 未覆盖该文件。",
            )),
            Err(error) => Err(error),
        }
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[tauri::command]
pub fn atomic_write_text(path: String, contents: String) -> Result<(), String> {
    atomic_write(PathBuf::from(path), contents.as_bytes())
}

#[tauri::command]
pub fn atomic_write_binary(path: String, contents: Vec<u8>) -> Result<(), String> {
    atomic_write(PathBuf::from(path), &contents)
}

#[tauri::command]
pub fn compare_and_swap_text(
    path: String,
    expected_contents: Option<String>,
    contents: String,
) -> Result<(), String> {
    compare_and_swap_text_path(PathBuf::from(path), expected_contents.as_deref(), &contents)
}

#[tauri::command]
pub fn read_text(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| safe_error("无法读取文件", e))
}

#[tauri::command]
pub fn read_text_if_exists(path: String) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(safe_error("无法读取目标文件", error)),
    }
}

#[tauri::command]
pub fn read_binary(path: String) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|e| safe_error("无法读取文件", e))
}

pub(crate) fn dwrite_path_from_arguments<I, S>(arguments: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: Into<std::ffi::OsString>,
{
    arguments.into_iter().find_map(|argument| {
        let path = PathBuf::from(argument.into());
        let is_dwrite = path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("dwrite"));
        is_dwrite.then(|| path.to_string_lossy().into_owned())
    })
}

#[tauri::command]
pub fn startup_document_path() -> Option<String> {
    dwrite_path_from_arguments(std::env::args_os().skip(1))
}

#[tauri::command]
pub fn take_pending_open_documents(
    pending: tauri::State<'_, PendingOpenDocuments>,
) -> Result<Vec<String>, String> {
    pending.drain()
}

fn recovery_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("recovery"))
        .map_err(|e| safe_error("无法定位恢复目录", e))
}

fn recovery_file_name(document_id: &str) -> String {
    format!("{}.dwrite", hex::encode(document_id.as_bytes()))
}

fn recovery_path(app: &AppHandle, document_id: &str) -> Result<PathBuf, String> {
    Ok(recovery_dir(app)?.join(recovery_file_name(document_id)))
}

fn recovery_document_id(contents: &str) -> Option<String> {
    serde_json::from_str::<Value>(contents)
        .ok()
        .and_then(|value| value.get("id").and_then(Value::as_str).map(str::to_owned))
}

#[tauri::command]
pub fn write_recovery(app: AppHandle, document_id: String, contents: String) -> Result<(), String> {
    if document_id.trim().is_empty() {
        return Err("恢复文档 ID 不能为空".into());
    }
    atomic_write(recovery_path(&app, &document_id)?, contents.as_bytes())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryPayload {
    pub key: String,
    pub contents: String,
}

fn recovery_key_from_path(path: &Path) -> Option<String> {
    let encoded = path.file_stem()?.to_str()?;
    String::from_utf8(hex::decode(encoded).ok()?).ok()
}

#[tauri::command]
pub fn read_recovery(app: AppHandle) -> Result<Option<RecoveryPayload>, String> {
    let directory = recovery_dir(&app)?;
    if !directory.exists() {
        return Ok(None);
    }

    let mut candidates: Vec<(SystemTime, PathBuf)> = fs::read_dir(&directory)
        .map_err(|e| safe_error("无法读取恢复目录", e))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("dwrite") {
                return None;
            }
            let modified = entry
                .metadata()
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            Some((modified, path))
        })
        .collect();
    candidates.sort_by(|left, right| right.0.cmp(&left.0));

    for (_, path) in candidates {
        if let Ok(contents) = fs::read_to_string(&path) {
            if let Some(document_id) = recovery_document_id(&contents) {
                let key = recovery_key_from_path(&path).or_else(|| {
                    (path.file_name().and_then(|value| value.to_str()) == Some("pending.dwrite"))
                        .then_some(document_id)
                });
                if let Some(key) = key {
                    return Ok(Some(RecoveryPayload { key, contents }));
                }
            }
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn clear_recovery(app: AppHandle, document_id: String) -> Result<(), String> {
    let path = recovery_path(&app, &document_id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| safe_error("无法清理恢复内容", e))?;
    }

    let legacy = recovery_dir(&app)?.join("pending.dwrite");
    if legacy.exists() {
        let should_remove = fs::read_to_string(&legacy)
            .ok()
            .and_then(|contents| recovery_document_id(&contents))
            .is_some_and(|id| id == document_id);
        if should_remove {
            fs::remove_file(legacy).map_err(|e| safe_error("无法清理旧版恢复内容", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn vault_password() -> Result<String, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| safe_error("无法访问 Windows 凭据管理器", e))?;
    match entry.get_password() {
        Ok(password) => Ok(password),
        Err(keyring::Error::NoEntry) => {
            let mut bytes = [0_u8; 32];
            rand::rng().fill_bytes(&mut bytes);
            let password = hex::encode(bytes);
            entry
                .set_password(&password)
                .map_err(|e| safe_error("无法保存本机保险库凭据", e))?;
            Ok(password)
        }
        Err(error) => Err(safe_error("无法读取本机保险库凭据", error)),
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .user_agent("DeepWrite/0.1")
        .build()
        .map_err(|e| safe_error("无法初始化网络客户端", e))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepSeekRequest {
    pub api_key: String,
    pub model: String,
    pub messages: Vec<Value>,
    pub max_tokens: u32,
    pub response_format: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub success: bool,
    pub message: String,
}

fn allowed_model(model: &str) -> bool {
    model == "deepseek-v4-flash" || model == "deepseek-v4-pro"
}

async fn response_error(response: reqwest::Response) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "DeepSeek 返回了错误".to_string());
    format!(
        "HTTP {}: {}",
        status.as_u16(),
        message.chars().take(240).collect::<String>()
    )
}

#[tauri::command]
pub async fn test_deepseek(api_key: String, model: String) -> Result<TestResult, String> {
    if api_key.trim().is_empty() {
        return Ok(TestResult {
            success: false,
            message: "请先填写 API Key".into(),
        });
    }
    if !allowed_model(&model) {
        return Ok(TestResult {
            success: false,
            message: "模型名称不在允许列表中".into(),
        });
    }
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "Reply with OK."}],
        "max_tokens": 4,
        "stream": false
    });
    let response = client()?
        .post(DEEPSEEK_ENDPOINT)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| safe_error("连接 DeepSeek 失败", e))?;
    if response.status().is_success() {
        Ok(TestResult {
            success: true,
            message: "连接成功".into(),
        })
    } else {
        Ok(TestResult {
            success: false,
            message: response_error(response).await,
        })
    }
}

#[tauri::command]
pub async fn call_deepseek(request: DeepSeekRequest) -> Result<Value, String> {
    if request.api_key.trim().is_empty() {
        return Err("未配置 DeepSeek API Key".into());
    }
    if !allowed_model(&request.model) {
        return Err("模型名称不在允许列表中".into());
    }
    let mut body = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "max_tokens": request.max_tokens.min(8192),
        "stream": false
    });
    if let Some(format) = request.response_format {
        body["response_format"] = format;
    }
    let response = client()?
        .post(DEEPSEEK_ENDPOINT)
        .bearer_auth(request.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| safe_error("DeepSeek 请求失败", e))?;
    if !response.status().is_success() {
        return Err(response_error(response).await);
    }
    response
        .json::<Value>()
        .await
        .map_err(|e| safe_error("无法解析 DeepSeek 响应", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_supported_models_are_allowed() {
        assert!(allowed_model("deepseek-v4-flash"));
        assert!(allowed_model("deepseek-v4-pro"));
        assert!(!allowed_model("deepseek-chat"));
        assert!(!allowed_model("deepseek-reasoner"));
    }

    #[test]
    fn error_messages_are_bounded() {
        let message = safe_error("test", "x".repeat(1000));
        assert!(message.len() < 320);
    }

    #[test]
    fn recovery_names_are_path_safe_and_document_specific() {
        let first = recovery_file_name("doc/../one");
        let second = recovery_file_name("doc/../two");
        assert!(first.ends_with(".dwrite"));
        assert!(!first.contains('/'));
        assert!(!first.contains(".."));
        assert_ne!(first, second);
    }

    #[test]
    fn conditional_write_rejects_external_changes_without_overwriting_them() {
        let path = std::env::temp_dir().join(format!("deepwrite-cas-{}.dwrite", Uuid::new_v4()));
        fs::write(&path, "baseline").unwrap();
        compare_and_swap_text_path(path.clone(), Some("baseline"), "ours").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "ours");

        fs::write(&path, "external").unwrap();
        let error = compare_and_swap_text_path(path.clone(), Some("ours"), "new ours").unwrap_err();
        assert!(error.contains("保存冲突"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn conditional_write_creates_only_when_target_is_still_missing() {
        let path = std::env::temp_dir().join(format!("deepwrite-new-{}.dwrite", Uuid::new_v4()));
        compare_and_swap_text_path(path.clone(), None, "first").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "first");
        let error = compare_and_swap_text_path(path.clone(), None, "second").unwrap_err();
        assert!(error.contains("保存冲突"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "first");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn startup_document_argument_accepts_only_dwrite_paths() {
        let args = vec![
            std::ffi::OsString::from("notes.txt"),
            std::ffi::OsString::from(r"C:\Drafts\novel.dwrite"),
        ];
        assert_eq!(
            dwrite_path_from_arguments(args).as_deref(),
            Some(r"C:\Drafts\novel.dwrite")
        );
        assert!(dwrite_path_from_arguments(vec![std::ffi::OsString::from("notes.md")]).is_none());
    }

    #[test]
    fn pending_open_queue_preserves_order_and_drains_atomically() {
        let pending = PendingOpenDocuments::default();
        pending.push(r"C:\Drafts\one.dwrite".into()).unwrap();
        pending.push(r"C:\Drafts\two.dwrite".into()).unwrap();
        assert_eq!(
            pending.drain().unwrap(),
            vec![
                r"C:\Drafts\one.dwrite".to_string(),
                r"C:\Drafts\two.dwrite".to_string()
            ]
        );
        assert!(pending.drain().unwrap().is_empty());
    }
}
