use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const DEEPSEEK_ENDPOINT: &str = "https://api.deepseek.com/chat/completions";
const KEYRING_SERVICE: &str = "com.deepwrite.desktop";
const KEYRING_USER: &str = "stronghold-master-password";

fn safe_error(context: &str, error: impl std::fmt::Display) -> String {
    let detail = error.to_string();
    let trimmed: String = detail.chars().take(300).collect();
    format!("{context}: {trimmed}")
}

#[cfg(windows)]
fn replace_file(temp: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
    let ok = unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        Err(safe_error("无法安全替换文件", std::io::Error::last_os_error()))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(temp: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(temp, destination).map_err(|e| safe_error("无法安全替换文件", e))
}

fn atomic_write(path: PathBuf, data: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "目标路径没有父目录".to_string())?;
    fs::create_dir_all(parent).map_err(|e| safe_error("无法创建目录", e))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "目标文件名无效".to_string())?;
    let temp = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = File::create(&temp).map_err(|e| safe_error("无法创建临时文件", e))?;
        file.write_all(data).map_err(|e| safe_error("无法写入临时文件", e))?;
        file.sync_all().map_err(|e| safe_error("无法同步临时文件", e))?;
        drop(file);
        replace_file(&temp, &path)
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
pub fn read_text(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| safe_error("无法读取文件", e))
}

#[tauri::command]
pub fn read_binary(path: String) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|e| safe_error("无法读取文件", e))
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

#[tauri::command]
pub fn read_recovery(app: AppHandle) -> Result<Option<String>, String> {
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
            if recovery_document_id(&contents).is_some() {
                return Ok(Some(contents));
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
        .and_then(|value| value.pointer("/error/message").and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_else(|| "DeepSeek 返回了错误".to_string());
    format!("HTTP {}: {}", status.as_u16(), message.chars().take(240).collect::<String>())
}

#[tauri::command]
pub async fn test_deepseek(api_key: String, model: String) -> Result<TestResult, String> {
    if api_key.trim().is_empty() {
        return Ok(TestResult { success: false, message: "请先填写 API Key".into() });
    }
    if !allowed_model(&model) {
        return Ok(TestResult { success: false, message: "模型名称不在允许列表中".into() });
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
        Ok(TestResult { success: true, message: "连接成功".into() })
    } else {
        Ok(TestResult { success: false, message: response_error(response).await })
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
}
