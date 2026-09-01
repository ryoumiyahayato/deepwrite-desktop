from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {count}: {old[:100]!r}')
    target.write_text(text.replace(old, new, 1), encoding='utf-8')

# App imports and extracted contracts.
replace_once('src/App.tsx',
    "import { getCurrentWindow } from '@tauri-apps/api/window';\n",
    "import { getCurrentWindow } from '@tauri-apps/api/window';\nimport { listen } from '@tauri-apps/api/event';\n")
replace_once('src/App.tsx',
    "import { buildDocumentEvidence } from './domain/aiEvidence';\n",
    "import { SessionGeneration } from './domain/sessionGeneration';\nimport { buildVersionRecord } from './domain/versionHistory';\n")
replace_once('src/App.tsx',
    "import { isDiagnosticTask, requestSuggestions, testDeepSeekConnection, type AITask } from './services/deepseek';\n",
    "import { isDiagnosticTask, requestSuggestions, testDeepSeekConnection, type AITask } from './services/deepseek';\nimport { requestFullDocumentDiagnosis } from './services/diagnostics';\n")
replace_once('src/App.tsx',
    "import { deleteDeepSeekKey, hasDeepSeekKey, saveDeepSeekKey } from './services/secrets';\n",
    "import { deleteDeepSeekKey, hasDeepSeekKey, saveDeepSeekKey } from './services/secrets';\nimport { bytesToDataUri } from './utils/dataUri';\n")
old_helpers = '''function buildVersion(document: DeepWriteDocument, path: string | null, reason: string): VersionRecord {\n  return {\n    id: crypto.randomUUID(), documentId: documentInstanceKey(document.id, path), documentPath: path,\n    createdAt: new Date().toISOString(), reason,\n    wordCount: documentStats(plainText(document.content)).words,\n    snapshot: structuredClone(document)\n  };\n}\n\nfunction bytesToDataUri(bytes: Uint8Array, mime: string): string {\n  let binary = '';\n  const size = 0x8000;\n  for (let offset = 0; offset < bytes.length; offset += size) binary += String.fromCharCode(...bytes.subarray(offset, offset + size));\n  return `data:${mime};base64,${btoa(binary)}`;\n}\n\n'''
replace_once('src/App.tsx', old_helpers, '')
replace_once('src/App.tsx',
    "  const startupOpenAttemptedRef = useRef(false);\n",
    "  const startupOpenAttemptedRef = useRef(false);\n  const sessionGenerationRef = useRef(new SessionGeneration());\n")
replace_once('src/App.tsx',
    "      setDocument((current) => ({ ...current, content: activeEditor.getJSON(), updatedAt: new Date().toISOString(), revision: current.revision + 1 }));\n",
    "      sessionGenerationRef.current.bump();\n      setDocument((current) => ({ ...current, content: activeEditor.getJSON(), updatedAt: new Date().toISOString(), revision: current.revision + 1 }));\n")
replace_once('src/App.tsx',
    "      const current = documentRef.current;\n      try {\n",
    "      const current = documentRef.current;\n      const generation = sessionGenerationRef.current.current();\n      try {\n")
replace_once('src/App.tsx',
    "          const stillCurrent = documentRef.current.id === current.id && documentRef.current.revision === current.revision;\n",
    "          const stillCurrent = documentRef.current.id === current.id && sessionGenerationRef.current.isCurrent(generation);\n")
replace_once('src/App.tsx',
    "    const record = buildVersion(source, pathRef.current, reason);\n",
    "    const record = buildVersionRecord(source, pathRef.current, reason);\n")
replace_once('src/App.tsx',
    "    const sourcePath = pathRef.current;\n    setSaveState('saving');\n",
    "    const sourcePath = pathRef.current;\n    const generation = sessionGenerationRef.current.current();\n    setSaveState('saving');\n")
replace_once('src/App.tsx',
    "      const stillCurrent = documentRef.current.id === source.id && documentRef.current.revision === source.revision;\n",
    "      const stillCurrent = documentRef.current.id === source.id && sessionGenerationRef.current.isCurrent(generation);\n")
replace_once('src/App.tsx',
    "      const identityChanged = saved.document.id !== source.id;\n      documentRef.current = saved.document;\n",
    "      const identityChanged = saved.document.id !== source.id;\n      if (identityChanged) sessionGenerationRef.current.reset();\n      documentRef.current = saved.document;\n")

# Loaded/new/restored sessions reset transient generation and synchronously update refs.
replace_once('src/App.tsx',
    "        editor.commands.setContent(loaded.document.content, { emitUpdate: false });\n        setDocument(loaded.document); setPath(loaded.path); setSaveState('saved');\n",
    "        editor.commands.setContent(loaded.document.content, { emitUpdate: false });\n        sessionGenerationRef.current.reset(); documentRef.current = loaded.document; pathRef.current = loaded.path;\n        setDocument(loaded.document); setPath(loaded.path); setSaveState('saved');\n")
replace_once('src/App.tsx',
    "        const imported = { ...createDocument(loaded.title), content: editor.getJSON(), revision: 1, metadata: { importedFrom: loaded.sourcePath, importedAt: new Date().toISOString() } };\n        setDocument(imported); setPath(null); setSaveState('unsaved');\n",
    "        const imported = { ...createDocument(loaded.title), content: editor.getJSON(), revision: 1, metadata: { importedFrom: loaded.sourcePath, importedAt: new Date().toISOString() } };\n        sessionGenerationRef.current.reset(); documentRef.current = imported; pathRef.current = null;\n        setDocument(imported); setPath(null); setSaveState('unsaved');\n")
replace_once('src/App.tsx',
    "    loadingRef.current = false;\n    setDocument(created); setPath(null); setSaveState('unsaved'); setSuggestions([]); setContinuation(null); setAISummary('');\n",
    "    loadingRef.current = false;\n    sessionGenerationRef.current.reset(); documentRef.current = created; pathRef.current = null;\n    setDocument(created); setPath(null); setSaveState('unsaved'); setSuggestions([]); setContinuation(null); setAISummary('');\n")

# Single-instance file handoff uses the same guarded transition as Open/Open Recent.
startup_anchor = "  }, [applyLoaded, editor]);\n\n  const openFile = useCallback(async () => {\n"
startup_new = '''  }, [applyLoaded, editor]);\n\n  useEffect(() => {\n    if (!editor || !isTauri()) return;\n    let unlisten: (() => void) | undefined;\n    void listen<string>('deepwrite://open-document', (event) => {\n      void (async () => {\n        const decision = await prepareDocumentTransition();\n        if (decision === 'cancel') return;\n        const previousDocumentId = documentRef.current.id;\n        const previousPath = pathRef.current;\n        await applyLoaded(await openDocumentAtPath(event.payload));\n        await commitDiscard(decision, previousDocumentId, previousPath);\n      })().catch((caught) => setError(`无法打开来自第二实例的文档：${String(caught)}`));\n    }).then((dispose) => { unlisten = dispose; });\n    return () => { unlisten?.(); };\n  }, [applyLoaded, commitDiscard, editor, prepareDocumentTransition]);\n\n  const openFile = useCallback(async () => {\n'''
replace_once('src/App.tsx', startup_anchor, startup_new)

# Full-document diagnostic tasks no longer require a selected range and cover all bounded batches.
replace_once('src/App.tsx',
    "    if (!selected.trim() && task !== 'continue') { setError('请先选择要分析的文字。'); return; }\n",
    "    if (!selected.trim() && task !== 'continue' && !isDiagnosticTask(task)) { setError('请先选择要分析的文字。'); return; }\n")
replace_once('src/App.tsx',
    "    const evidenceBudget = Math.max(1200, max - selected.length - (flankLimit * 2));\n    const evidence = isDiagnosticTask(task) ? buildDocumentEvidence(fullText, evidenceBudget) : null;\n",
    "    const evidenceBudget = Math.max(1200, max - selected.length - (flankLimit * 2));\n")
try_anchor = "    try {\n      const response = await requestSuggestions(task, {\n"
try_new = '''    try {\n      if (isDiagnosticTask(task)) {\n        const summary = await requestFullDocumentDiagnosis({\n          task, fullText, evidenceBudget,\n          baseContext: { selected, before, after, chapterSummary, authorRules: settingsRef.current.ai.authorRules, customInstruction },\n          settings: settingsRef.current, context,\n          isCurrent: () => documentRef.current.id === context.documentId && documentRef.current.revision === context.documentRevision\n        });\n        setAISummary(summary); setSuggestions([]); editor.commands.setAiSuggestionDecorations([]); setAIState('idle');\n        return;\n      }\n      const response = await requestSuggestions(task, {\n'''
replace_once('src/App.tsx', try_anchor, try_new)
replace_once('src/App.tsx',
    "        selected, before, after, chapterSummary,\n        documentEvidence: evidence?.text,\n        scopeLabel: evidence?.scopeLabel,\n        authorRules: settingsRef.current.ai.authorRules,\n",
    "        selected, before, after, chapterSummary,\n        authorRules: settingsRef.current.ai.authorRules,\n")
replace_once('src/App.tsx',
    "      setAISummary(evidence?.scopeLabel ? `${evidence.scopeLabel}\n${response.summary}` : response.summary);\n",
    "      setAISummary(response.summary);\n")

# Version history API now owns raw-id/path compatibility migration.
replace_once('src/App.tsx',
    "    try { setVersions(await listVersions(documentInstanceKey(documentRef.current.id, pathRef.current))); setHistoryOpen(true); }\n",
    "    try { setVersions(await listVersions(documentRef.current.id, pathRef.current)); setHistoryOpen(true); }\n")
replace_once('src/App.tsx',
    "    try { await clearVersions(documentInstanceKey(documentRef.current.id, pathRef.current)); setVersions([]); }\n",
    "    try { await clearVersions(documentRef.current.id, pathRef.current); setVersions([]); }\n")

# Restoring/title/recovery are local edits and must advance/reset transient session generation.
replace_once('src/App.tsx',
    "    editor.commands.setContent(version.snapshot.content, { emitUpdate: false }); loadingRef.current = false;\n    setDocument({ ...version.snapshot, updatedAt: new Date().toISOString(), revision: documentRef.current.revision + 1 });\n",
    "    editor.commands.setContent(version.snapshot.content, { emitUpdate: false }); loadingRef.current = false;\n    const restored = { ...version.snapshot, updatedAt: new Date().toISOString(), revision: documentRef.current.revision + 1 };\n    sessionGenerationRef.current.bump(); documentRef.current = restored; setDocument(restored);\n")
replace_once('src/App.tsx',
    "onChange={(event) => { const title = event.target.value; setDocument((current) => ({ ...current, title, updatedAt: new Date().toISOString(), revision: current.revision + 1 })); setSaveState('unsaved'); }}",
    "onChange={(event) => { const title = event.target.value; sessionGenerationRef.current.bump(); setDocument((current) => ({ ...current, title, updatedAt: new Date().toISOString(), revision: current.revision + 1 })); setSaveState('unsaved'); }}")
replace_once('src/App.tsx',
    "setDocument(recovered.document); setPath(null); setSaveState('unsaved');",
    "sessionGenerationRef.current.reset(); documentRef.current = recovered.document; pathRef.current = null; setDocument(recovered.document); setPath(null); setSaveState('unsaved');")

# Backend: single-instance handoff, history asset migration, and least-dependency cleanup.
replace_once('src-tauri/src/commands.rs',
    "fn dwrite_path_from_arguments<I>(arguments: I) -> Option<String>\nwhere\n    I: IntoIterator<Item = std::ffi::OsString>,\n{\n    arguments.into_iter().find_map(|argument| {\n        let path = PathBuf::from(argument);\n",
    "pub(crate) fn dwrite_path_from_arguments<I, S>(arguments: I) -> Option<String>\nwhere\n    I: IntoIterator<Item = S>,\n    S: Into<std::ffi::OsString>,\n{\n    arguments.into_iter().find_map(|argument| {\n        let path = PathBuf::from(argument.into());\n")
replace_once('src-tauri/src/lib.rs',
    "use tauri::Manager;\n",
    "use tauri::{Emitter, Manager};\n")
replace_once('src-tauri/src/lib.rs',
    '''        Migration {\n            version: 2,\n            description: "remove legacy AI suggestion payloads containing document text",\n            sql: "DELETE FROM ai_suggestions;",\n            kind: MigrationKind::Up,\n        },\n''',
    '''        Migration {\n            version: 2,\n            description: "remove legacy AI suggestion payloads containing document text",\n            sql: "DELETE FROM ai_suggestions;",\n            kind: MigrationKind::Up,\n        },\n        Migration {\n            version: 3,\n            description: "deduplicate embedded history image assets",\n            sql: r#"\n              CREATE TABLE IF NOT EXISTS history_assets (\n                asset_key TEXT PRIMARY KEY, data_uri TEXT NOT NULL, created_at TEXT NOT NULL\n              );\n            "#,\n            kind: MigrationKind::Up,\n        },\n''')
replace_once('src-tauri/src/lib.rs',
    "pub fn run() {\n    tauri::Builder::default()\n        .plugin(tauri_plugin_dialog::init())\n",
    '''pub fn run() {\n    let mut builder = tauri::Builder::default();\n    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]\n    {\n        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {\n            if let Some(path) = commands::dwrite_path_from_arguments(args.into_iter().skip(1)) {\n                let _ = app.emit("deepwrite://open-document", path);\n            }\n            if let Some(window) = app.get_webview_window("main") {\n                let _ = window.show();\n                let _ = window.unminimize();\n                let _ = window.set_focus();\n            }\n        }));\n    }\n\n    builder\n        .plugin(tauri_plugin_dialog::init())\n''')
replace_once('src-tauri/Cargo.toml', 'tauri-plugin-fs = "2"\n', '')
replace_once('src-tauri/Cargo.toml',
    "[target.'cfg(windows)'.dependencies]\n",
    "[target.'cfg(any(target_os = \"macos\", windows, target_os = \"linux\"))'.dependencies]\ntauri-plugin-single-instance = \"2\"\n\n[target.'cfg(windows)'.dependencies]\n")
replace_once('package.json', '    "@tauri-apps/plugin-fs": "^2",\n', '')
replace_once('src-tauri/tauri.conf.json',
    "      \"csp\": \"default-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self' asset: http://asset.localhost data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:\"\n",
    "      \"csp\": \"default-src 'self'; script-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self' asset: http://asset.localhost data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'\"\n")

print('P2 integration patch applied successfully')
