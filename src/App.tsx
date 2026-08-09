import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '@tiptap/react';
import { FileText, PanelLeftClose, PanelRightClose } from 'lucide-react';
import './App.css';
import { AIPanel } from './components/AIPanel';
import { EditorCanvas } from './components/EditorCanvas';
import { ErrorNotice, FindReplaceDialog, HistoryDialog, RecoveryDialog, SettingsDialog } from './components/Dialogs';
import { MenuBar, type MenuActions } from './components/MenuBar';
import { OutlinePanel } from './components/OutlinePanel';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { createSuggestionContext, isSuggestionStale, stableHash, type AISuggestion } from './domain/ai';
import { recentContext, shouldAutoAnalyze } from './domain/autoAnalysis';
import {
  createDocument,
  documentStats,
  extractOutline,
  plainText,
  type DeepWriteDocument
} from './domain/document';
import { defaultSettings, type AppSettings } from './domain/settings';
import { editorExtensions } from './editor/extensions';
import {
  addRecentFile,
  createVersion,
  listRecentFiles,
  listVersions,
  loadSettings,
  recordSuggestions,
  saveSettings,
  type RecentFile,
  type VersionRecord
} from './services/database';
import { requestSuggestions, testDeepSeekConnection, type AITask } from './services/deepseek';
import {
  chooseAndOpenDocument,
  clearRecovery,
  exportDocument,
  openDocumentAtPath,
  readRecovery,
  saveDwrite,
  writeRecovery,
  type ImportedContent
} from './services/documentFiles';
import { chooseOpenPath, fileNameFromPath, isTauri, readBinary } from './services/platform';
import { deleteDeepSeekKey, hasDeepSeekKey, saveDeepSeekKey } from './services/secrets';

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';
type AIState = 'idle' | 'running' | 'error';

function buildVersion(document: DeepWriteDocument, path: string | null, reason: string): VersionRecord {
  return {
    id: crypto.randomUUID(), documentId: document.id, documentPath: path,
    createdAt: new Date().toISOString(), reason,
    wordCount: documentStats(plainText(document.content)).words,
    snapshot: structuredClone(document)
  };
}

function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
  return `data:${mime};base64,${btoa(binary)}`;
}

export default function App() {
  const [document, setDocument] = useState<DeepWriteDocument>(() => createDocument());
  const [path, setPath] = useState<string | null>(null);
  const [settings, setSettingsState] = useState<AppSettings>(defaultSettings);
  const [saveState, setSaveState] = useState<SaveState>('unsaved');
  const [aiState, setAIState] = useState<AIState>('idle');
  const [aiSummary, setAISummary] = useState('');
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [aiCollapsed, setAICollapsed] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [storedKey, setStoredKey] = useState(false);
  const [findMode, setFindMode] = useState<'find' | 'replace' | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [recovery, setRecovery] = useState<DeepWriteDocument | null>(null);
  const [error, setError] = useState('');
  const loadingRef = useRef(false);
  const documentRef = useRef(document);
  const pathRef = useRef(path);
  const settingsRef = useRef(settings);
  const lastAutoHash = useRef<string | null>(null);

  useEffect(() => { documentRef.current = document; }, [document]);
  useEffect(() => { pathRef.current = path; }, [path]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const editor = useEditor({
    extensions: editorExtensions,
    content: document.content,
    immediatelyRender: false,
    editorProps: { attributes: { class: 'deepwrite-editor', spellcheck: 'true', 'aria-label': '文档编辑区' } },
    onUpdate: ({ editor: activeEditor }) => {
      if (loadingRef.current) return;
      setDocument((current) => ({ ...current, content: activeEditor.getJSON(), updatedAt: new Date().toISOString(), revision: current.revision + 1 }));
      setSaveState('unsaved');
    }
  });

  const refreshRecent = useCallback(async (limit = settingsRef.current.general.recentFilesLimit) => {
    try { setRecentFiles(await listRecentFiles(limit)); } catch (caught) { setError(String(caught)); }
  }, []);

  useEffect(() => {
    Promise.all([loadSettings(), listRecentFiles(defaultSettings.general.recentFilesLimit)]).then(([loaded, recent]) => {
      setSettingsState(loaded); setRecentFiles(recent);
    }).catch((caught) => setError(`初始化本地设置失败：${String(caught)}`));
    if (isTauri()) readRecovery().then(setRecovery).catch((caught) => setError(`恢复检查失败：${String(caught)}`));
  }, []);

  useEffect(() => {
    const theme = settings.appearance.theme;
    window.document.documentElement.dataset.theme = theme;
    window.document.documentElement.style.colorScheme = theme === 'system' ? 'light dark' : theme;
    window.document.documentElement.style.setProperty('--document-font', `${JSON.stringify(settings.editor.defaultFont)}, "Source Han Serif SC", SimSun, serif`);
    window.document.documentElement.style.setProperty('--document-font-size', `${settings.editor.defaultFontSize}px`);
    window.document.documentElement.style.setProperty('--document-line-height', String(settings.editor.defaultLineHeight));
  }, [settings.appearance.theme, settings.editor]);

  useEffect(() => {
    window.document.title = `${document.title}${saveState === 'unsaved' ? ' •' : ''} — DeepWrite`;
  }, [document.title, saveState]);

  useEffect(() => {
    if (document.revision === 0) return;
    const timer = window.setTimeout(async () => {
      const current = documentRef.current;
      try {
        await writeRecovery(current);
        if (settingsRef.current.general.autosaveEnabled && pathRef.current) {
          setSaveState('saving');
          await saveDwrite(current, pathRef.current, false, settingsRef.current.general.defaultSaveDirectory);
          setSaveState('saved');
          await clearRecovery();
        }
      } catch (caught) { setSaveState('error'); setError(`自动保存失败：${String(caught)}`); }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [document.revision]);

  const snapshot = useCallback(async (reason: string) => {
    const record = buildVersion(documentRef.current, pathRef.current, reason);
    await createVersion(record);
    return record;
  }, []);

  const applyLoaded = useCallback(async (loaded: ImportedContent) => {
    if (!editor) return;
    loadingRef.current = true;
    try {
      if (loaded.kind === 'document') {
        editor.commands.setContent(loaded.document.content, { emitUpdate: false });
        setDocument(loaded.document); setPath(loaded.path); setSaveState('saved');
        await addRecentFile(loaded.path, loaded.document.title, settingsRef.current.general.recentFilesLimit);
      } else {
        await snapshot('重要导入操作前');
        editor.commands.setContent(loaded.html, { emitUpdate: false });
        const imported = { ...createDocument(loaded.title), content: editor.getJSON(), revision: 1, metadata: { importedFrom: loaded.sourcePath, importedAt: new Date().toISOString() } };
        setDocument(imported); setPath(null); setSaveState('unsaved');
        if (loaded.warnings.length) setError(`导入完成，含 ${loaded.warnings.length} 条兼容性提示：${loaded.warnings[0]}`);
      }
      setSuggestions([]); setAISummary(''); editor.commands.setAiSuggestionDecorations([]);
      await refreshRecent();
    } finally { loadingRef.current = false; }
  }, [editor, refreshRecent, snapshot]);

  const openFile = useCallback(async () => {
    try { const loaded = await chooseAndOpenDocument(); if (loaded) await applyLoaded(loaded); }
    catch (caught) { setError(`打开失败：${String(caught)}`); }
  }, [applyLoaded]);

  const openRecent = useCallback(async (recentPath: string) => {
    try { await applyLoaded(await openDocumentAtPath(recentPath)); }
    catch (caught) { setError(`无法打开最近文件：${String(caught)}`); }
  }, [applyLoaded]);

  const newDocument = useCallback(() => {
    if (!editor) return;
    const created = createDocument();
    loadingRef.current = true;
    editor.commands.setContent(created.content, { emitUpdate: false });
    loadingRef.current = false;
    setDocument(created); setPath(null); setSaveState('unsaved'); setSuggestions([]); setAISummary('');
    editor.commands.setAiSuggestionDecorations([]);
  }, [editor]);

  const manualSave = useCallback(async (saveAs = false) => {
    if (!editor) return;
    setSaveState('saving');
    const current = { ...documentRef.current, content: editor.getJSON(), updatedAt: new Date().toISOString() };
    try {
      await snapshot('手动保存');
      const savedPath = await saveDwrite(current, pathRef.current, saveAs, settingsRef.current.general.defaultSaveDirectory);
      if (!savedPath) { setSaveState('unsaved'); return; }
      setPath(savedPath); setDocument(current); setSaveState('saved');
      await Promise.all([clearRecovery(), addRecentFile(savedPath, current.title, settingsRef.current.general.recentFilesLimit)]);
      await refreshRecent();
    } catch (caught) { setSaveState('error'); setError(`保存失败：${String(caught)}`); }
  }, [editor, refreshRecent, snapshot]);

  const runExport = useCallback(async (format: 'docx' | 'txt' | 'md' | 'html') => {
    if (!editor) return;
    try { await exportDocument(format, documentRef.current.title, editor.getJSON(), editor.getHTML(), editor.getText({ blockSeparator: '\n' }), settingsRef.current.general.defaultSaveDirectory); }
    catch (caught) { setError(`导出 ${format.toUpperCase()} 失败：${String(caught)}`); }
  }, [editor]);

  const insertImage = useCallback(async () => {
    if (!editor) return;
    try {
      const imagePath = await chooseOpenPath(['png', 'jpg', 'jpeg', 'gif', 'webp'], '图片');
      if (!imagePath) return;
      const ext = imagePath.split('.').pop()?.toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext === 'svg' ? 'svg+xml' : ext}`;
      editor.chain().focus().setImage({ src: bytesToDataUri(await readBinary(imagePath), mime), alt: fileNameFromPath(imagePath), width: 480 }).run();
    } catch (caught) { setError(`插入图片失败：${String(caught)}`); }
  }, [editor]);

  const performAI = useCallback(async (task: AITask, forced?: { from: number; to: number; text: string }) => {
    if (!editor) return;
    const { from: selectedFrom, to: selectedTo } = editor.state.selection;
    let from = forced?.from ?? selectedFrom; let to = forced?.to ?? selectedTo;
    let selected = forced?.text ?? editor.state.doc.textBetween(from, to, '\n');
    if (!selected.trim()) {
      if (task !== 'continue') { setError('请先选择要分析的文字。'); return; }
      to = editor.state.doc.content.size; from = Math.max(1, to - 2000); selected = editor.state.doc.textBetween(from, to, '\n');
    }
    const max = settingsRef.current.ai.maxContextCharacters;
    if (selected.length > max) { selected = selected.slice(0, max); to = from + selected.length; }
    const customInstruction = task === 'custom' ? window.prompt('请输入自定义写作要求') ?? '' : undefined;
    if (task === 'custom' && !customInstruction?.trim()) return;
    const context = createSuggestionContext(documentRef.current.id, documentRef.current.revision, from, to, selected);
    const before = editor.state.doc.textBetween(Math.max(0, from - Math.floor(max / 3)), from, '\n');
    const after = editor.state.doc.textBetween(to, Math.min(editor.state.doc.content.size, to + Math.floor(max / 3)), '\n');
    const chapterSummary = extractOutline(documentRef.current.content).slice(-3).map((item) => item.text).join(' › ');
    setAIState('running'); setAICollapsed(false);
    try {
      const response = await requestSuggestions(task, { selected, before, after, chapterSummary, authorRules: settingsRef.current.ai.authorRules, customInstruction }, settingsRef.current, context);
      setAISummary(response.summary); setSuggestions(response.suggestions); setAIState('idle');
      editor.commands.setAiSuggestionDecorations(response.suggestions);
      await recordSuggestions(documentRef.current.id, documentRef.current.revision, response.suggestions);
    } catch (caught) { setAIState('error'); setError(caught instanceof Error ? caught.message : String(caught)); }
  }, [editor]);

  useEffect(() => {
    const minutes = settings.ai.idleAnalysisMinutes;
    if (!editor || !shouldAutoAnalyze(minutes, document.revision > 0, editor.getText(), lastAutoHash.current)) return;
    const timer = window.setTimeout(() => {
      const text = recentContext(editor.getText({ blockSeparator: '\n' }), Math.min(settings.ai.maxContextCharacters, 4000));
      const hash = stableHash(text);
      if (hash === lastAutoHash.current) return;
      lastAutoHash.current = hash;
      const to = editor.state.doc.content.size; const from = Math.max(1, to - text.length);
      void performAI('auto', { from, to, text });
    }, minutes * 60_000);
    return () => window.clearTimeout(timer);
  }, [document.revision, editor, performAI, settings.ai.idleAnalysisMinutes, settings.ai.maxContextCharacters]);

  const syncSuggestions = useCallback((next: AISuggestion[]) => {
    setSuggestions(next); editor?.commands.setAiSuggestionDecorations(next);
  }, [editor]);

  const acceptSuggestion = useCallback(async (id: string) => {
    if (!editor) return;
    const suggestion = suggestions.find((item) => item.id === id);
    if (!suggestion || suggestion.status !== 'pending' || suggestion.targetFrom === null || suggestion.targetTo === null) return;
    const current = editor.state.doc.textBetween(suggestion.targetFrom, suggestion.targetTo, '');
    if (isSuggestionStale(suggestion, current, documentRef.current.id)) {
      syncSuggestions(suggestions.map((item) => item.id === id ? { ...item, status: 'stale' } : item)); return;
    }
    try { await snapshot('执行 AI 替换前'); editor.chain().focus().insertContentAt({ from: suggestion.targetFrom, to: suggestion.targetTo }, suggestion.replacement).run(); syncSuggestions(suggestions.map((item) => item.id === id ? { ...item, status: 'accepted' } : item)); }
    catch (caught) { setError(`接受建议失败：${String(caught)}`); }
  }, [editor, snapshot, suggestions, syncSuggestions]);

  const acceptAll = useCallback(async () => {
    if (!editor) return;
    const pending = suggestions.filter((item) => item.status === 'pending' && item.targetFrom !== null && item.targetTo !== null).sort((a, b) => (b.targetFrom ?? 0) - (a.targetFrom ?? 0));
    if (!pending.length) return;
    await snapshot('批量接受 AI 修改前');
    const statuses = new Map<string, AISuggestion['status']>();
    for (const suggestion of pending) {
      const current = editor.state.doc.textBetween(suggestion.targetFrom!, suggestion.targetTo!, '');
      if (isSuggestionStale(suggestion, current, documentRef.current.id)) statuses.set(suggestion.id, 'stale');
      else { editor.chain().focus().insertContentAt({ from: suggestion.targetFrom!, to: suggestion.targetTo! }, suggestion.replacement).run(); statuses.set(suggestion.id, 'accepted'); }
    }
    syncSuggestions(suggestions.map((item) => statuses.has(item.id) ? { ...item, status: statuses.get(item.id)! } : item));
  }, [editor, snapshot, suggestions, syncSuggestions]);

  const rejectSuggestion = useCallback((id: string) => syncSuggestions(suggestions.map((item) => item.id === id ? { ...item, status: 'rejected' } : item)), [suggestions, syncSuggestions]);
  const rejectAll = useCallback(() => syncSuggestions(suggestions.map((item) => item.status === 'pending' ? { ...item, status: 'rejected' } : item)), [suggestions, syncSuggestions]);

  const findText = useCallback((query: string) => {
    if (!editor || !query) return;
    const start = editor.state.selection.to;
    const rest = editor.state.doc.textBetween(start, editor.state.doc.content.size, '\n');
    let offset = rest.indexOf(query); let from = start + offset;
    if (offset < 0) { const all = editor.getText({ blockSeparator: '\n' }); offset = all.indexOf(query); from = 1 + offset; }
    if (offset >= 0) editor.chain().focus().setTextSelection({ from, to: from + query.length }).run();
    else setError(`未找到“${query}”`);
  }, [editor]);

  const replaceText = useCallback((query: string, replacement: string) => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (editor.state.doc.textBetween(from, to, '') === query) editor.chain().focus().insertContentAt({ from, to }, replacement).run();
    findText(query);
  }, [editor, findText]);

  const replaceAll = useCallback((query: string, replacement: string) => {
    if (!editor || !query) return;
    editor.commands.command(({ tr, state }) => {
      const matches: Array<{ from: number; to: number }> = [];
      state.doc.descendants((node, position) => {
        if (!node.isText || !node.text) return;
        let index = node.text.indexOf(query);
        while (index >= 0) { matches.push({ from: position + index, to: position + index + query.length }); index = node.text.indexOf(query, index + query.length); }
      });
      matches.reverse().forEach((match) => tr.insertText(replacement, match.from, match.to));
      return matches.length > 0;
    });
  }, [editor]);

  const openHistory = useCallback(async () => {
    try { setVersions(await listVersions(documentRef.current.id)); setHistoryOpen(true); }
    catch (caught) { setError(`无法加载版本历史：${String(caught)}`); }
  }, []);

  const restoreVersion = useCallback(async (version: VersionRecord) => {
    if (!editor) return;
    await snapshot('恢复旧版本前'); loadingRef.current = true;
    editor.commands.setContent(version.snapshot.content, { emitUpdate: false }); loadingRef.current = false;
    setDocument({ ...version.snapshot, updatedAt: new Date().toISOString(), revision: documentRef.current.revision + 1 });
    setSaveState('unsaved'); setHistoryOpen(false);
  }, [editor, snapshot]);

  const saveAppSettings = useCallback(async (next: AppSettings) => { await saveSettings(next); setSettingsState(next); await refreshRecent(next.general.recentFilesLimit); }, [refreshRecent]);

  const menuActions = useMemo<MenuActions>(() => ({
    newDocument, open: openFile, save: () => void manualSave(false), saveAs: () => void manualSave(true),
    exportDocx: () => void runExport('docx'), exportTxt: () => void runExport('txt'), exportMd: () => void runExport('md'), exportHtml: () => void runExport('html'),
    find: () => setFindMode('find'), replace: () => setFindMode('replace'), settings: () => { void hasDeepSeekKey().then(setStoredKey); setSettingsOpen(true); },
    history: () => void openHistory(), toggleOutline: () => setOutlineCollapsed((value) => !value), toggleAI: () => setAICollapsed((value) => !value), print: () => window.print()
  }), [manualSave, newDocument, openFile, openHistory, runExport]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === 'n') { event.preventDefault(); newDocument(); }
      if (key === 'o') { event.preventDefault(); void openFile(); }
      if (key === 's') { event.preventDefault(); void manualSave(event.shiftKey); }
      if (key === 'f') { event.preventDefault(); setFindMode('find'); }
      if (key === 'h') { event.preventDefault(); setFindMode('replace'); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [manualSave, newDocument, openFile]);

  const text = editor?.getText({ blockSeparator: '\n' }) ?? plainText(document.content);
  const stats = documentStats(text);
  const outline = extractOutline(document.content);

  return <div className="app-shell">
    <div className="document-title-row"><FileText /><input value={document.title} aria-label="文档标题" onChange={(event) => { const title = event.target.value; setDocument((current) => ({ ...current, title, updatedAt: new Date().toISOString(), revision: current.revision + 1 })); setSaveState('unsaved'); }} /><span>{path ?? '尚未保存为 .dwrite'}</span><button onClick={() => setOutlineCollapsed((value) => !value)} title="切换章节大纲"><PanelLeftClose /></button><button onClick={() => setAICollapsed((value) => !value)} title="切换 AI 面板"><PanelRightClose /></button></div>
    <MenuBar actions={menuActions} />
    <Toolbar key={`${settings.editor.defaultFont}-${settings.editor.defaultFontSize}-${settings.editor.defaultLineHeight}`} editor={editor} defaults={settings.editor} onInsertImage={() => void insertImage()} />
    <div className="workspace-grid">
      <OutlinePanel items={outline} collapsed={outlineCollapsed} onToggle={() => setOutlineCollapsed((value) => !value)} onNavigate={(position) => editor?.chain().focus().setTextSelection(Math.max(1, position)).run()} recentFiles={recentFiles} onOpenRecent={(recentPath) => void openRecent(recentPath)} onHistory={() => void openHistory()} onSettings={menuActions.settings} />
      <EditorCanvas editor={editor} zoom={zoom} />
      <AIPanel collapsed={aiCollapsed} onToggle={() => setAICollapsed((value) => !value)} status={aiState} summary={aiSummary} suggestions={suggestions} onRun={(task) => void performAI(task)} onAccept={(id) => void acceptSuggestion(id)} onReject={rejectSuggestion} onAcceptAll={() => void acceptAll()} onRejectAll={rejectAll} />
    </div>
    <StatusBar stats={stats} saveState={saveState} aiState={aiState} zoom={zoom} onZoom={setZoom} />
    {settingsOpen ? <SettingsDialog initial={settings} hasKey={storedKey} onClose={() => setSettingsOpen(false)} onSave={saveAppSettings} onSaveKey={async (key) => { await saveDeepSeekKey(key); setStoredKey(true); }} onDeleteKey={async () => { await deleteDeepSeekKey(); setStoredKey(false); }} onTest={testDeepSeekConnection} /> : null}
    {findMode ? <FindReplaceDialog replaceMode={findMode === 'replace'} onClose={() => setFindMode(null)} onFind={findText} onReplace={replaceText} onReplaceAll={replaceAll} /> : null}
    {historyOpen ? <HistoryDialog versions={versions} onClose={() => setHistoryOpen(false)} onRestore={(version) => void restoreVersion(version)} /> : null}
    {recovery ? <RecoveryDialog document={recovery} onRestore={() => { if (editor) { loadingRef.current = true; editor.commands.setContent(recovery.content, { emitUpdate: false }); loadingRef.current = false; } setDocument(recovery); setPath(null); setSaveState('unsaved'); setRecovery(null); }} onDiscard={() => { void clearRecovery(); setRecovery(null); }} /> : null}
    {error ? <ErrorNotice message={error} onClose={() => setError('')} /> : null}
  </div>;
}
