import Database from '@tauri-apps/plugin-sql';
import type { AISuggestion } from '../domain/ai';
import type { AppSettings } from '../domain/settings';
import type { DeepWriteDocument } from '../domain/document';
import { defaultSettings, settingsSchema } from '../domain/settings';
import { isTauri } from './platform';

export interface RecentFile { path: string; title: string; openedAt: string }
export interface VersionRecord {
  id: string;
  documentId: string;
  documentPath: string | null;
  createdAt: string;
  reason: string;
  wordCount: number;
  snapshot: DeepWriteDocument;
}

let databasePromise: Promise<Database> | null = null;
const memoryVersions: VersionRecord[] = [];
const memoryRecent: RecentFile[] = [];

async function db(): Promise<Database> {
  databasePromise ??= Database.load('sqlite:deepwrite.db');
  return databasePromise;
}

export async function loadSettings(): Promise<AppSettings> {
  if (!isTauri()) {
    const value = localStorage.getItem('deepwrite.settings');
    return value ? settingsSchema.catch(defaultSettings).parse(JSON.parse(value)) : structuredClone(defaultSettings);
  }
  const rows = await (await db()).select<Array<{ value: string }>>('SELECT value FROM settings WHERE key = $1', ['app']);
  if (!rows[0]) return structuredClone(defaultSettings);
  return settingsSchema.catch(defaultSettings).parse(JSON.parse(rows[0].value));
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const value = JSON.stringify(settingsSchema.parse(settings));
  if (!isTauri()) { localStorage.setItem('deepwrite.settings', value); return; }
  await (await db()).execute(
    'INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    ['app', value, new Date().toISOString()]
  );
}

export async function addRecentFile(path: string, title: string, limit: number): Promise<void> {
  const openedAt = new Date().toISOString();
  if (!isTauri()) {
    const existing = memoryRecent.findIndex((item) => item.path === path);
    if (existing >= 0) memoryRecent.splice(existing, 1);
    memoryRecent.unshift({ path, title, openedAt });
    memoryRecent.splice(limit);
    return;
  }
  const database = await db();
  await database.execute(
    'INSERT INTO recent_files (path, title, opened_at) VALUES ($1, $2, $3) ON CONFLICT(path) DO UPDATE SET title = excluded.title, opened_at = excluded.opened_at',
    [path, title, openedAt]
  );
  await database.execute('DELETE FROM recent_files WHERE path NOT IN (SELECT path FROM recent_files ORDER BY opened_at DESC LIMIT $1)', [limit]);
}

export async function listRecentFiles(limit: number): Promise<RecentFile[]> {
  if (!isTauri()) return memoryRecent.slice(0, limit);
  const rows = await (await db()).select<Array<{ path: string; title: string; opened_at: string }>>(
    'SELECT path, title, opened_at FROM recent_files ORDER BY opened_at DESC LIMIT $1', [limit]
  );
  return rows.map((row) => ({ path: row.path, title: row.title, openedAt: row.opened_at }));
}

export async function createVersion(record: VersionRecord): Promise<void> {
  if (!isTauri()) { memoryVersions.unshift(record); return; }
  await (await db()).execute(
    'INSERT INTO versions (id, document_id, document_path, created_at, reason, word_count, snapshot_json) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [record.id, record.documentId, record.documentPath, record.createdAt, record.reason, record.wordCount, JSON.stringify(record.snapshot)]
  );
}

export async function listVersions(documentId: string): Promise<VersionRecord[]> {
  if (!isTauri()) return memoryVersions.filter((version) => version.documentId === documentId);
  const rows = await (await db()).select<Array<{
    id: string; document_id: string; document_path: string | null; created_at: string;
    reason: string; word_count: number; snapshot_json: string;
  }>>('SELECT * FROM versions WHERE document_id = $1 ORDER BY created_at DESC', [documentId]);
  return rows.map((row) => ({
    id: row.id, documentId: row.document_id, documentPath: row.document_path,
    createdAt: row.created_at, reason: row.reason, wordCount: row.word_count,
    snapshot: JSON.parse(row.snapshot_json) as DeepWriteDocument
  }));
}

export async function recordSuggestions(documentId: string, revision: number, suggestions: AISuggestion[]): Promise<void> {
  if (!isTauri()) return;
  const database = await db();
  const createdAt = new Date().toISOString();
  await Promise.all(suggestions.map((suggestion) => database.execute(
    'INSERT OR REPLACE INTO ai_suggestions (id, document_id, revision, created_at, status, payload_json) VALUES ($1,$2,$3,$4,$5,$6)',
    [suggestion.id, documentId, revision, createdAt, suggestion.status, JSON.stringify(suggestion)]
  )));
}
