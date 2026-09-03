from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one guarded match, found {count}')
    write(path, text.replace(old, new, 1))


# Serialized persistence queue. Transitions can wait until both autosave and manual-save work is idle.
Path('src/domain/persistenceQueue.ts').write_text("""export class PersistenceQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => undefined).then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async waitForIdle(): Promise<void> {
    while (true) {
      const observed = this.tail;
      await observed;
      if (observed === this.tail) return;
    }
  }
}
""", encoding='utf-8')

Path('src/domain/persistenceQueue.test.ts').write_text("""import { describe, expect, it } from 'vitest';
import { PersistenceQueue } from './persistenceQueue';

describe('PersistenceQueue', () => {
  it('serializes persistence operations and waitForIdle observes later queued work', async () => {
    const queue = new PersistenceQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = queue.run(async () => {
      order.push('first-start');
      await firstGate;
      order.push('first-end');
    });
    const idle = queue.waitForIdle().then(() => order.push('idle'));
    const second = queue.run(async () => { order.push('second'); });

    releaseFirst();
    await Promise.all([first, second, idle]);
    expect(order).toEqual(['first-start', 'first-end', 'second', 'idle']);
  });
});
""", encoding='utf-8')

# AI overlapping anchors: search from first + 1 rather than needle length.
replace_once(
    'src/domain/ai.ts',
    "  const second = haystack.indexOf(needle, first + Math.max(1, needle.length));",
    "  const second = haystack.indexOf(needle, first + 1);",
)
replace_once(
    'src/domain/ai.test.ts',
    """    expect(attachSuggestionContext(duplicate, duplicateContext)[0].relativeFrom).toBeNull();

    const multilineContext = createSuggestionContext('doc-1', 1, 1, 20, '第一段\\n第二段');
""",
    """    expect(attachSuggestionContext(duplicate, duplicateContext)[0].relativeFrom).toBeNull();

    const overlappingContext = createSuggestionContext('doc-1', 1, 1, 4, '哈哈哈');
    const overlapping = aiResponseSchema.parse({
      ...validResponse,
      suggestions: [{ ...validResponse.suggestions[0], original: '哈哈' }]
    });
    expect(attachSuggestionContext(overlapping, overlappingContext)[0].relativeFrom).toBeNull();

    const multilineContext = createSuggestionContext('doc-1', 1, 1, 20, '第一段\\n第二段');
""",
)

# Zero text offset must resolve into an inline parent instead of document position 0.
replace_once(
    'src/editor/suggestionTargets.ts',
    """  if (offset < 0 || offset > selected.length) return null;
  if (offset === 0) return from;

  let low = from;
""",
    """  if (offset < 0 || offset > selected.length) return null;
  if (offset === 0) {
    for (let position = from; position <= to; position += 1) {
      if (document.resolve(position).parent.inlineContent) return position;
    }
    return null;
  }

  let low = from;
""",
)
replace_once(
    'src/editor/suggestionTargets.test.ts',
    """describe('structured AI suggestion target mapping', () => {
  it('maps a text offset through multiple ProseMirror blocks', () => {
""",
    """describe('structured AI suggestion target mapping', () => {
  it('maps zero offset at the document boundary to the first inline text position', () => {
    const document = schema.node('doc', null, [paragraph('开头'), paragraph('第二段')]);
    const position = positionAtTextOffset(document, 0, document.content.size, 0);
    expect(position).toBe(1);
    expect(document.resolve(position!).parent.inlineContent).toBe(true);
  });

  it('maps a text offset through multiple ProseMirror blocks', () => {
""",
)

# Recovery: Rust returns ordered candidates; TypeScript skips any candidate that fails the authoritative document parser.
replace_once(
    'src-tauri/src/commands.rs',
    """#[tauri::command]
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
""",
    """#[tauri::command]
pub fn read_recovery_candidates(app: AppHandle) -> Result<Vec<RecoveryPayload>, String> {
    let directory = recovery_dir(&app)?;
    if !directory.exists() {
        return Ok(Vec::new());
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

    let mut recoveries = Vec::new();
    for (_, path) in candidates {
        if let Ok(contents) = fs::read_to_string(&path) {
            if let Some(document_id) = recovery_document_id(&contents) {
                let key = recovery_key_from_path(&path).or_else(|| {
                    (path.file_name().and_then(|value| value.to_str()) == Some("pending.dwrite"))
                        .then_some(document_id)
                });
                if let Some(key) = key {
                    recoveries.push(RecoveryPayload { key, contents });
                }
            }
        }
    }
    Ok(recoveries)
}
""",
)
replace_once(
    'src-tauri/src/lib.rs',
    '            commands::read_recovery,',
    '            commands::read_recovery_candidates,',
)
replace_once(
    'src/services/documentFiles.ts',
    """export async function readRecovery(): Promise<RecoveredDwrite | null> {
  const payload = await invokeCommand<RecoveryPayload | null>('read_recovery');
  if (!payload) return null;
  return { key: payload.key, document: parseDocument(payload.contents) };
}
""",
    """export function firstValidRecovery(payloads: RecoveryPayload[]): RecoveredDwrite | null {
  for (const payload of payloads) {
    try {
      return { key: payload.key, document: parseDocument(payload.contents) };
    } catch {
      // A corrupt or future-schema recovery must not hide an older valid candidate.
    }
  }
  return null;
}

export async function readRecovery(): Promise<RecoveredDwrite | null> {
  return firstValidRecovery(await invokeCommand<RecoveryPayload[]>('read_recovery_candidates'));
}
""",
)
replace_once(
    'src/services/documentFiles.test.ts',
    "import { sameDocumentPath } from './documentFiles';",
    "import { firstValidRecovery, sameDocumentPath } from './documentFiles';",
)
replace_once(
    'src/services/documentFiles.test.ts',
    """  it('treats Windows path spelling variants as the same physical target', () => {
    expect(sameDocumentPath('C:\\\\Books\\\\Novel.dwrite', 'c:/books/novel.dwrite')).toBe(true);
    expect(sameDocumentPath('C:\\\\Books\\\\Novel.dwrite', 'C:\\\\Books\\\\Copy.dwrite')).toBe(false);
    expect(sameDocumentPath(null, 'C:\\\\Books\\\\Novel.dwrite')).toBe(false);
  });
""",
    """  it('treats Windows path spelling variants as the same physical target', () => {
    expect(sameDocumentPath('C:\\\\Books\\\\Novel.dwrite', 'c:/books/novel.dwrite')).toBe(true);
    expect(sameDocumentPath('C:\\\\Books\\\\Novel.dwrite', 'C:\\\\Books\\\\Copy.dwrite')).toBe(false);
    expect(sameDocumentPath(null, 'C:\\\\Books\\\\Novel.dwrite')).toBe(false);
  });

  it('skips a newer invalid recovery and returns the next valid document', () => {
    const valid = JSON.stringify({
      schemaVersion: 2,
      editorSchema: 'tiptap-v1',
      id: 'doc-valid',
      title: '可恢复',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      revision: 1,
      metadata: {}
    });
    const recovered = firstValidRecovery([
      { key: 'future', contents: JSON.stringify({ schemaVersion: 999, id: 'future' }) },
      { key: 'valid', contents: valid }
    ]);
    expect(recovered?.key).toBe('valid');
    expect(recovered?.document.id).toBe('doc-valid');
  });
""",
)

# Version history: prune all legacy document identities at startup using the configured positive retention bound.
replace_once(
    'src/services/database.ts',
    """export async function loadSettings(): Promise<AppSettings> {
  if (!isTauri()) {
    const value = localStorage.getItem('deepwrite.settings');
    return value ? settingsSchema.catch(defaultSettings).parse(JSON.parse(value)) : structuredClone(defaultSettings);
  }
  const rows = await (await db()).select<Array<{ value: string }>>('SELECT value FROM settings WHERE key = $1', ['app']);
  if (!rows[0]) return structuredClone(defaultSettings);
  return settingsSchema.catch(defaultSettings).parse(JSON.parse(rows[0].value));
}
""",
    """async function prunePersistedVersionHistory(limit: number): Promise<void> {
  if (!isTauri() || limit <= 0) return;
  const database = await db();
  await database.execute(`
    DELETE FROM versions WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY document_id ORDER BY created_at DESC, id DESC
        ) AS row_number
        FROM versions
      ) WHERE row_number > $1
    )
  `, [limit]);
  await garbageCollectHistoryAssets(database);
}

export async function loadSettings(): Promise<AppSettings> {
  if (!isTauri()) {
    const value = localStorage.getItem('deepwrite.settings');
    return value ? settingsSchema.catch(defaultSettings).parse(JSON.parse(value)) : structuredClone(defaultSettings);
  }
  const rows = await (await db()).select<Array<{ value: string }>>('SELECT value FROM settings WHERE key = $1', ['app']);
  const settings = rows[0]
    ? settingsSchema.catch(defaultSettings).parse(JSON.parse(rows[0].value))
    : structuredClone(defaultSettings);
  await prunePersistedVersionHistory(settings.general.versionHistoryLimit);
  return settings;
}
""",
)

# App persistence and async revalidation.
replace_once(
    'src/App.tsx',
    "import { SessionGeneration } from './domain/sessionGeneration';",
    "import { PersistenceQueue } from './domain/persistenceQueue';\nimport { SessionGeneration } from './domain/sessionGeneration';",
)
replace_once(
    'src/App.tsx',
    "  const sessionGenerationRef = useRef(new SessionGeneration());",
    "  const sessionGenerationRef = useRef(new SessionGeneration());\n  const persistenceQueueRef = useRef(new PersistenceQueue());",
)
# Make saveStateRef synchronous with state writes. Replace current calls first, then add wrapper.
app = read('src/App.tsx').replace('setSaveState(', 'updateSaveState(')
anchor = "  useEffect(() => { saveStateRef.current = saveState; }, [saveState]);\n"
if app.count(anchor) != 1:
    raise SystemExit('App.tsx: saveState ref anchor mismatch')
app = app.replace(anchor, anchor + "\n  const updateSaveState = useCallback((next: SaveState) => {\n    saveStateRef.current = next;\n    setSaveState(next);\n  }, []);\n", 1)
write('src/App.tsx', app)

# Snapshot can explicitly bind to the saved path without mutating the active session early.
replace_once(
    'src/App.tsx',
    """  const snapshot = useCallback(async (reason: string, source = documentRef.current) => {
    const record = buildVersionRecord(source, pathRef.current, reason);
""",
    """  const snapshot = useCallback(async (reason: string, source = documentRef.current, snapshotPath = pathRef.current) => {
    const record = buildVersionRecord(source, snapshotPath, reason);
""",
)

# Replace autosave effect with serialized persistence.
start = read('src/App.tsx')
old_auto = """  useEffect(() => {
    if (document.revision === 0) return;
    const timer = window.setTimeout(async () => {
      const current = documentRef.current;
      const generation = sessionGenerationRef.current.current();
      try {
        await writeRecovery(current, pathRef.current);
        if (settingsRef.current.general.autosaveEnabled && pathRef.current) {
          updateSaveState('saving');
          await saveDwrite(current, pathRef.current, false, settingsRef.current.general.defaultSaveDirectory);
          const stillCurrent = documentRef.current.id === current.id && sessionGenerationRef.current.isCurrent(generation);
          if (stillCurrent) {
            updateSaveState('saved');
            await clearRecovery(current.id, pathRef.current);
          } else {
            updateSaveState('unsaved');
          }
        }
      } catch (caught) { updateSaveState('error'); setError(`自动保存失败：${String(caught)}`); }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [document.revision]);
"""
new_auto = """  useEffect(() => {
    if (document.revision === 0) return;
    const timer = window.setTimeout(() => {
      const current = documentRef.current;
      const currentPath = pathRef.current;
      const generation = sessionGenerationRef.current.current();
      void persistenceQueueRef.current.run(async () => {
        if (documentRef.current.id !== current.id || !sessionGenerationRef.current.isCurrent(generation)) return;
        try {
          await writeRecovery(current, currentPath);
          if (settingsRef.current.general.autosaveEnabled && currentPath) {
            updateSaveState('saving');
            await saveDwrite(current, currentPath, false, settingsRef.current.general.defaultSaveDirectory);
            const stillCurrent = documentRef.current.id === current.id && sessionGenerationRef.current.isCurrent(generation);
            if (stillCurrent) {
              await clearRecovery(current.id, currentPath);
              if (documentRef.current.id === current.id && sessionGenerationRef.current.isCurrent(generation)) updateSaveState('saved');
              else {
                updateSaveState('unsaved');
                await writeRecovery(documentRef.current, pathRef.current);
              }
            } else {
              updateSaveState('unsaved');
            }
          }
        } catch (caught) {
          updateSaveState('error');
          setError(`自动保存失败：${String(caught)}`);
        }
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [document.revision, updateSaveState]);
"""
if start.count(old_auto) != 1:
    raise SystemExit('App.tsx: autosave guarded block mismatch')
write('src/App.tsx', start.replace(old_auto, new_auto, 1))

# Replace manual save with queued operation and final revalidation after all awaited bookkeeping.
text = read('src/App.tsx')
manual_start = text.index('  const manualSave = useCallback(')
manual_end = text.index('\n\n  const prepareDocumentTransition', manual_start)
old_manual = text[manual_start:manual_end]
new_manual = """  const manualSave = useCallback((saveAs = false): Promise<boolean> => {
    if (!editor) return Promise.resolve(false);
    return persistenceQueueRef.current.run(async () => {
      const source = { ...documentRef.current, content: editor.getJSON(), updatedAt: new Date().toISOString() };
      const sourcePath = pathRef.current;
      const generation = sessionGenerationRef.current.current();
      updateSaveState('saving');
      try {
        const saved = await saveDwrite(source, sourcePath, saveAs, settingsRef.current.general.defaultSaveDirectory);
        if (!saved) { updateSaveState('unsaved'); return false; }
        await addRecentFile(saved.path, saved.document.title, settingsRef.current.general.recentFilesLimit);
        await refreshRecent();
        try { await snapshot('手动保存', saved.document, saved.path); }
        catch (historyError) { setError(`文档已保存，但版本快照失败：${String(historyError)}`); }
        await clearRecovery(source.id, sourcePath);

        const stillCurrent = documentRef.current.id === source.id && sessionGenerationRef.current.isCurrent(generation);
        if (!stillCurrent) {
          updateSaveState('unsaved');
          try { await writeRecovery(documentRef.current, pathRef.current); } catch { /* unsaved guard remains authoritative */ }
          return false;
        }

        const identityChanged = saved.document.id !== source.id;
        pathRef.current = saved.path;
        setPath(saved.path);
        if (identityChanged) sessionGenerationRef.current.reset();
        documentRef.current = saved.document;
        setDocument(saved.document);
        updateSaveState('saved');
        if (identityChanged) {
          setSuggestions([]); setContinuation(null); setAISummary(''); editor.commands.setAiSuggestionDecorations([]);
        }
        return true;
      } catch (caught) {
        try { await writeRecovery(source, sourcePath); } catch { /* keep the original save error */ }
        updateSaveState('error'); setError(`保存失败：${String(caught)}`); return false;
      }
    });
  }, [editor, refreshRecent, snapshot, updateSaveState]);"""
write('src/App.tsx', text[:manual_start] + new_manual + text[manual_end:])

# Transition waits for any in-flight save before offering discard or replacing the session.
replace_once(
    'src/App.tsx',
    """  const prepareDocumentTransition = useCallback(async (): Promise<TransitionDecision> => {
    if (!needsDocumentTransitionGuard(saveStateRef.current)) return 'proceed';
""",
    """  const prepareDocumentTransition = useCallback(async (): Promise<TransitionDecision> => {
    await persistenceQueueRef.current.waitForIdle();
    if (!needsDocumentTransitionGuard(saveStateRef.current)) return 'proceed';
""",
)

# Single suggestion: session generation + exact target revalidation after asynchronous snapshot.
replace_once(
    'src/App.tsx',
    """    try {
      await snapshot('执行 AI 替换前');
      editor.chain().focus().insertContentAt({ from: suggestion.targetFrom, to: suggestion.targetTo }, suggestion.replacement).run();
""",
    """    try {
      const generation = sessionGenerationRef.current.current();
      await snapshot('执行 AI 替换前');
      const currentAfterSnapshot = editor.state.doc.textBetween(suggestion.targetFrom, suggestion.targetTo, '\\n');
      if (!sessionGenerationRef.current.isCurrent(generation) || isSuggestionStale(suggestion, currentAfterSnapshot, documentRef.current.id, documentRef.current.revision)) {
        syncSuggestions(suggestions.map((item) => item.id === id ? { ...item, status: 'stale' } : item));
        return;
      }
      editor.chain().focus().insertContentAt({ from: suggestion.targetFrom, to: suggestion.targetTo }, suggestion.replacement).run();
""",
)

# Accept all: abort entire batch if anything changed while snapshotting.
replace_once(
    'src/App.tsx',
    """    const originalRevision = documentRef.current.revision;
    await snapshot('批量接受 AI 修改前');
    const statuses = new Map<string, AISuggestion['status']>();
""",
    """    const originalDocumentId = documentRef.current.id;
    const originalRevision = documentRef.current.revision;
    const generation = sessionGenerationRef.current.current();
    await snapshot('批量接受 AI 修改前');
    if (documentRef.current.id !== originalDocumentId || !sessionGenerationRef.current.isCurrent(generation)) {
      syncSuggestions(suggestions.map((item) => item.status === 'pending' ? { ...item, status: 'stale' } : item));
      return;
    }
    const statuses = new Map<string, AISuggestion['status']>();
""",
)

# Continuation: revalidate generation and context immediately after snapshot.
replace_once(
    'src/App.tsx',
    """      await snapshot('插入 AI 续写前');
      const paragraphs = continuation.text.split(/\\n+/).map((value) => value.trim()).filter(Boolean).map((value) => ({ type: 'paragraph', content: [{ type: 'text', text: value }] }));
""",
    """      const generation = sessionGenerationRef.current.current();
      await snapshot('插入 AI 续写前');
      if (
        !sessionGenerationRef.current.isCurrent(generation) ||
        continuation.context.documentId !== documentRef.current.id ||
        continuation.context.documentRevision !== documentRef.current.revision
      ) {
        setError('创建版本快照期间原文已经变化。为避免把旧上下文续写插入新版本，请重新生成。');
        return;
      }
      const paragraphs = continuation.text.split(/\\n+/).map((value) => value.trim()).filter(Boolean).map((value) => ({ type: 'paragraph', content: [{ type: 'text', text: value }] }));
""",
)

# Security/retention docs.
replace_once(
    'README.md',
    "* SQLite: `deepwrite.db`. It stores recent files, settings, local history metadata, AI suggestion metadata, and version-history snapshots. **Version snapshots contain complete historical `.dwrite` document content.** By default at most 50 snapshots are retained per document; the limit can be changed in Settings, including `0` to disable new snapshots. The current document's History dialog can delete all of its local snapshots.",
    "* SQLite: `deepwrite.db`. It stores recent files, settings, local history metadata, AI suggestion metadata, and version-history snapshots. **Version snapshots contain complete historical `.dwrite` document content.** By default at most 50 snapshots are retained per document; the positive configured retention bound is also enforced across legacy histories during startup. The limit can be changed in Settings, including `0` to disable new snapshots without automatically deleting existing history. The current document's History dialog can delete all of its local snapshots.",
)
replace_once(
    'docs/phase1-safety-contracts.md',
    "- Autosave completion may mark the UI saved or clear recovery only when it still belongs to the current document session generation.\n",
    "- Autosave and manual saves are serialized. Document replacement waits for in-flight persistence before offering discard, and save completion may mark the UI saved or clear recovery only when it still belongs to the current document session generation.\n",
)
replace_once(
    'docs/phase1-safety-contracts.md',
    "- Crash recovery is document/path aware rather than a single global recovery slot.\n",
    "- Crash recovery is document/path aware rather than a single global recovery slot; corrupt or future-schema candidates are skipped so they cannot hide an older valid recovery.\n- Positive version-history retention is enforced across legacy document histories at startup, not only after a document creates a new snapshot.\n",
)

print('review blocker fixes applied')
