mod commands;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initialize local metadata database",
            sql: r#"
              CREATE TABLE IF NOT EXISTS recent_files (
                path TEXT PRIMARY KEY, title TEXT NOT NULL, opened_at TEXT NOT NULL
              );
              CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
              );
              CREATE TABLE IF NOT EXISTS versions (
                id TEXT PRIMARY KEY, document_id TEXT NOT NULL, document_path TEXT,
                created_at TEXT NOT NULL, reason TEXT NOT NULL, word_count INTEGER NOT NULL,
                snapshot_json TEXT NOT NULL
              );
              CREATE INDEX IF NOT EXISTS idx_versions_document ON versions(document_id, created_at DESC);
              CREATE TABLE IF NOT EXISTS ai_suggestions (
                id TEXT PRIMARY KEY, document_id TEXT NOT NULL, revision INTEGER NOT NULL,
                created_at TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL
              );
              CREATE TABLE IF NOT EXISTS document_history (
                document_id TEXT PRIMARY KEY, path TEXT, title TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_revision INTEGER NOT NULL
              );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "remove legacy AI suggestion payloads containing document text",
            sql: "DELETE FROM ai_suggestions;",
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:deepwrite.db", migrations())
                .build(),
        )
        .setup(|app| {
            let local_data = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&local_data)?;
            let salt_path = local_data.join("stronghold.salt");
            app.handle().plugin(
                tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build(),
            )?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::atomic_write_text,
            commands::atomic_write_binary,
            commands::compare_and_swap_text,
            commands::read_text,
            commands::read_text_if_exists,
            commands::read_binary,
            commands::startup_document_path,
            commands::write_recovery,
            commands::read_recovery,
            commands::clear_recovery,
            commands::vault_password,
            commands::test_deepseek,
            commands::call_deepseek,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DeepWrite");
}
