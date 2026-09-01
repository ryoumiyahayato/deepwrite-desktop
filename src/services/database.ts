import Database from '@tauri-apps/plugin-sql';
import type { AISuggestion } from '../domain/ai';
import type { AppSettings } from '../domain/settings';
import { parseDocument, type DeepWriteDocument } from '../domain/document';
import { documentInstanceKey, normalizeDocumentPath } from '../domain/documentIdentity';
import { externalizeHistorySnapshot, hydrateHistorySnapshot } from '../domain/historyAssets';
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

function samePath(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  return normalizeDocumentPath(left) === normalizeDocumentPath(right);
}

async function migrateLegacyVersionIdentity(documentId: string, documentPath: string | null, instanceKey: string): Promise<void> {
  if (instanceKey === documentId) return;
  if (!isTauri()) {
    for (const version of memoryVersions) {
      if (version.documentId === documentId && samePath(version.documentPath, documentPath)) version.documentId = instanceKey;
    }
    return;
  }
  const database = await db();
  const rows = await database.select<Array<{ id: string; document_path: string | null }>>(
    'SELECT id, document_path FROM versions WHERE document_id = $1', [documentId]
  );
  for (const row of rows) {
    if (samePath(row.document_path, documentPath)) {
      await database.execute('UPDATE versions SET document_id = $1 WHERE id = $2', [instanceKey, row.id]);
    }
  }
}

async function garbageCollectHistoryAssets(database: Database): Promise<void> {
  await database.execute(
    "DELETE FROM history_assets WHERE NOT EXISTS (SELECT 1 FROM versions WHERE instr(snapshot_json, 'deepwrite-history-asset:' || history_assets.asset_key) > 0)"
  );
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

export async function createVersion(record: VersionRecord, limit: number): Promise<void> {
  if (limit <= 0) return;
  if (!isTauri()) {
    memoryVersions.unshift({ ...record, snapshot: parseDocument(JSON.stringify(record.snapshot)) });
    const matching = memoryVersions.filter((version) => version.documentId === record.documentId);
    for (const obsolete of matching.slice(limit)) {
      const index = memoryVersions.findIndex((version) => version.id === obsolete.id);
      if (index >= 0) memoryVersions.splice(index, 1);
    }
    return;
  }
  const database = await db();
  const externalized = await externalizeHistorySnapshot(parseDocument(JSON.stringify(record.snapshot)));
  for (const asset of externalized.assets) {
    await database.execute(
      'INSERT OR IGNORE INTO history_assets (asset_key, data_uri, created_at) VALUES ($1,$2,$3)',
      [asset.key, asset.dataUri, new Date().toISOString()]
    );
  }
  await database.execute(
    'INSERT INTO versions (id, document_id, document_path, created_at, reason, word_count, snapshot_json) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [record.id, record.documentId, record.documentPath, record.createdAt, record.reason, record.wordCount, JSON.stringify(externalized.snapshot)]
  );
  await database.execute(
    'DELETE FROM versions WHERE document_id = $1 AND id NOT IN (SELECT id FROM versions WHERE document_id = $1 ORDER BY created_at DESC LIMIT $2)',
    [record.documentId, limit]
  );
  await garbageCollectHistoryAssets(database);
}

export async function listVersions(documentId: string, documentPath?: string | null): Promise<VersionRecord[]> {
  const instanceKey = documentPath === undefined ? documentId : documentInstanceKey(documentId, documentPath);
  if (documentPath !== undefined) await migrateLegacyVersionIdentity(documentId, documentPath, instanceKey);
  if (!isTauri()) {
    return memoryVersions
      .filter((version) => version.documentId === instanceKey)
      .map((version) => ({ ...version, snapshot: parseDocument(JSON.stringify(version.snapshot)) }));
  }
  const database = await db();
  const assetRows = await database.select<Array<{ asset_key: string; data_uri: string }>>('SELECT asset_key, data_uri FROM history_assets');
  const assets = new Map(assetRows.map((row) => [row.asset_key, row.data_uri]));
  const rows = await database.select<Array<{
    id: string; document_id: string; document_path: string | null; created_at: string;
    reason: string; word_count: number; snapshot_json: string;
  }>>('SELECT * FROM versions WHERE document_id = $1 ORDER BY created_at DESC', [instanceKey]);

  const versions: VersionRecord[] = [];
  for (const row of rows) {
    const migrated = parseDocument(row.snapshot_json);
    const externalized = await externalizeHistorySnapshot(migrated);
    for (const asset of externalized.assets) {
      assets.set(asset.key, asset.dataUri);
      await database.execute(
        'INSERT OR IGNORE INTO history_assets (asset_key, data_uri, created_at) VALUES ($1,$2,$3)',
        [asset.key, asset.dataUri, new Date().toISOString()]
      );
    }
    const compactJson = JSON.stringify(externalized.snapshot);
    if (compactJson !== row.snapshot_json) await database.execute('UPDATE versions SET snapshot_json = $1 WHERE id = $2', [compactJson, row.id]);
    versions.push({
      id: row.id,
      documentId: instanceKey,
      documentPath: row.document_path,
      createdAt: row.created_at,
      reason: row.reason,
      wordCount: row.word_count,
      snapshot: hydrateHistorySnapshot(externalized.snapshot, assets)
    });
  }
  await garbageCollectHistoryAssets(database);
  return versions;
}

export async function clearVersions(documentId: string, documentPath?: string | null): Promise<void> {
  const instanceKey = documentPath === undefined ? documentId : documentInstanceKey(documentId, documentPath);
  if (documentPath !== undefined) await migrateLegacyVersionIdentity(documentId, documentPath, instanceKey);
  if (!isTauri()) {
    for (let index = memoryVersions.length - 1; index >= 0; index -= 1) {
      if (memoryVersions[index].documentId === instanceKey) memoryVersions.splice(index, 1);
    }
    return;
  }
  const database = await db();
  await database.execute('DELETE FROM versions WHERE document_id = $1', [instanceKey]);
  await garbageCollectHistoryAssets(database);
}

export async function recordSuggestions(documentId: string, revision: number, suggestions: AISuggestion[]): Promise<void> {
  if (!isTauri()) return;
  const database = await db();
  const createdAt = new Date().toISOString();
  await Promise.all(suggestions.map((suggestion) => database.execute(
    'INSERT OR REPLACE INTO ai_suggestions (id, document_id, revision, created_at, status, payload_json) VALUES ($1,$2,$3,$4,$5,$6)',
    [suggestion.id, documentId, revision, createdAt, suggestion.status, JSON.stringify({ type: suggestion.type, severity: suggestion.severity, status: suggestion.status })]
  )));
}
