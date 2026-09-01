import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
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
import { createSuggestionContext, isSuggestionStale, stableHash, type AISuggestion, type SuggestionContext } from './domain/ai';
import { buildDocumentEvidence } from './domain/aiEvidence';
import { documentInstanceKey } from './domain/documentIdentity';
import { recentContext, shouldAutoAnalyze } from './domain/autoAnalysis';
import {
  createDocument,
  documentStats,
  extractOutline,
  plainText,
  type DeepWriteDocument
} from './domain/document';
import { needsDocumentTransitionGuard, shouldWarnBeforeClose, type SaveState } from './domain/session';
import { defaultSettings, type AppSettings } from './domain/settings';
import { editorExtensions } from './editor/extensions';
import { positionAtTextOffset, resolveSuggestionTargets } from './editor/suggestionTargets';
import {
  addRecentFile,
  clearVersions,
  createVersion,
  listRecentFiles,
  listVersions,
  loadSettings,
  recordSuggestions,
  saveSettings,
  type RecentFile,
  type VersionRecord
} from './services/database';
import { isDiagnosticTask, requestSuggestions, testDeepSeekConnection, type AITask } from './services/deepseek';
import {
  chooseAndOpenDocument,
  clearRecovery,
  clearRecoveryKey,
  exportDocument,
  openDocumentAtPath,
  readRecovery,
  saveDwrite,
  startupDocumentPath,
  writeRecovery,
  type ImportedContent,
  type RecoveredDwrite
} from './services/documentFiles';
import { chooseOpenPath, fileNameFromPath, isTauri, readBinary } from './services/platform';
import { deleteDeepSeekKey, hasDeepSeekKey, saveDeepSeekKey } from './services/secrets';

type AIState = 'idle' | 'running' | 'error';
type TransitionDecision = 'proceed' | 'discard' | 'cancel';
interface GeneratedContinuation { text: string; context: SuggestionContext }

function buildVersion(document: DeepWriteDocument, path: string | null, reason: string): VersionRecord {
  return {
    id: crypto.randomUUID(), documentId: documentInstanceKey(document.id, path), documentPath: path,
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
  const [continuation, setContinuation] = useState<GeneratedContinuation | null>(null);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [aiCollapsed, setAICollapsed] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [storedKey, setStoredKey] = useState(false);
  const [findMode, setFindMode] = useState<'find' | 'replace' | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [recovery, setRecovery] = useState<RecoveredDwrite | null>(null);
  const [error, setError] = useState('');
  const loadingRef = useRef(false);
  const documentRef = useRef(document);
  const pathRef = useRef(path);
  const settingsRef = useRef(settings);
  const saveStateRef = useRef(saveState);
  const lastAutoHash = useRef<string | null>(null);
  const startupOpenAttemptedRef = useRef(false);

  useEffect(() => { documentRef.current = document; }, [document]);
  useEffect(() => { pathRef.current = path; }, [path]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { saveStateRef.current = saveState; }, [saveState]);

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
    window.document.title = `${document.title}${saveState === 'unsaved' || saveState === 'error' ? ' •' : ''} — DeepWrite`;
  }, [document.title, saveState]);

  useEffect(() => {
    if (document.revision === 0) return;
    const timer = window.setTimeout(async () => {
      const current = documentRef.current;
      try {
        await writeRecovery(current, pathRef.current);
        if (settingsRef.current.general.autosaveEnabled && pathRef.current) {
          setSaveState('saving');
          await saveDwrite(current, pathRef.current, false, settingsRef.current.general.defaultSaveDirectory);
          const stillCurrent = documentRef.current.id === current.id && documentRef.current.revision === current.revision;
          if (stillCurrent) {
            setSaveState('saved');
            await clearRecovery(current.id, pathRef.current);
          } else {
            setSaveState('unsaved');
          }
        }
      } catch (caught) { setSaveState('error'); setError(`自动保存失败：${String(caught)}`); }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [document.revision]);

  const snapshot = useCallback(async (reason: string, source = documentRef.current) => {
    const record = buildVersion(source, pathRef.current, reason);
    await createVersion(record, settingsRef.current.general.versionHistoryLimit);
    return record;
  }, []);

  const manualSave = useCallback(async (saveAs = false): Promise<boolean> => {
    if (!editor) return false;
    const source = { ...documentRef.current, content: editor.getJSON(), updatedAt: new Date().toISOString() };
    const sourcePath = pathRef.current;
    setSaveState('saving');
    try {
      const saved = await saveDwrite(source, sourcePath, saveAs, settingsRef.current.general.defaultSaveDirectory);
      if (!saved) { setSaveState('unsaved'); return false; }
      const stillCurrent = documentRef.current.id === source.id && documentRef.current.revision === source.revision;
      await addRecentFile(saved.path, saved.document.title, settingsRef.current.general.recentFilesLimit);
      await refreshRecent();
      if (!stillCurrent) {
        setSaveState('unsaved');
        return false;
      }
      pathRef.current = saved.path;
      setPath(saved.path);
      try { await snapshot('手动保存', saved.document); }
      catch (historyError) { setError(`文档已保存，但版本快照失败：${String(historyError)}`); }
      const identityChanged = saved.document.id !== source.id;
      documentRef.current = saved.document;
      setDocument(saved.document);
      setSaveState('saved');
      await clearRecovery(source.id, sourcePath);
      if (identityChanged) {
        setSuggestions([]); setContinuation(null); setAISummary(''); editor.commands.setAiSuggestionDecorations([]);
      }
      return true;
    } catch (caught) {
      try { await writeRecovery(source, sourcePath); } catch { /* keep the original save error */ }
      setSaveState('error'); setError(`保存失败：${String(caught)}`); return false;
    }
  }, [editor, refreshRecent, snapshot]);

  const prepareDocumentTransition = useCallback(async (): Promise<TransitionDecision> => {
    if (!needsDocumentTransitionGuard(saveStateRef.current)) return 'proceed';
    const saveFirst = window.confirm('当前文档有尚未确认写入磁盘的修改。\n\n确定：先保存并继续。\n取消：选择是否放弃这些修改。');
    if (saveFirst) return await manualSave(false) ? 'proceed' : 'cancel';
    const discard = window.confirm('确定要放弃当前未保存的修改吗？\n\n确定：放弃并继续。\n取消：返回当前文档。');
    return discard ? 'discard' : 'cancel';
  }, [manualSave]);

  const commitDiscard = useCallback(async (decision: TransitionDecision, documentId: string, documentPath: string | null) => {
    if (decision !== 'discard') return;
    try { await clearRecovery(documentId, documentPath); }
    catch (caught) { setError(`已切换文档，但无法清理被放弃文档的恢复副本：${String(caught)}`); }
  }, []);

  useEffect(() => {
    if (isTauri()) {
      let unlisten: (() => void) | undefined;
      const appWindow = getCurrentWindow();
      void appWindow.onCloseRequested(async (event) => {
        if (!shouldWarnBeforeClose(saveStateRef.current)) return;
        event.preventDefault();
        const decision = await prepareDocumentTransition();
        if (decision === 'cancel') return;
        if (decision === 'discard') {
          try { await clearRecovery(documentRef.current.id, pathRef.current); }
          catch (caught) { setError(`无法清理被放弃文档的恢复副本：${String(caught)}`); }
        }
        await appWindow.destroy();
      }).then((dispose) => { unlisten = dispose; });
      return () => { unlisten?.(); };
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldWarnBeforeClose(saveStateRef.current)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [prepareDocumentTransition]);

  const applyLoaded = useCallback(async (loaded: ImportedContent) => {
    if (!editor) return;
    loadingRef.current = true;
    try {
      if (loaded.kind === 'document') {
        editor.commands.setContent(loaded.document.content, { emitUpdate: false });
        setDocument(loaded.document); setPath(loaded.path); setSaveState('saved');
        await addRecentFile(loaded.path, loaded.document.title, settingsRef.current.general.recentFilesLimit);
      } else {
        editor.commands.setContent(loaded.html, { emitUpdate: false });
        const imported = { ...createDocument(loaded.title), content: editor.getJSON(), revision: 1, metadata: { importedFrom: loaded.sourcePath, importedAt: new Date().toISOString() } };
        setDocument(imported); setPath(null); setSaveState('unsaved');
        if (loaded.warnings.length) setError(`导入完成，含 ${loaded.warnings.length} 条兼容性提示：${loaded.warnings[0]}`);
      }
      setSuggestions([]); setContinuation(null); setAISummary(''); editor.commands.setAiSuggestionDecorations([]);
      await refreshRecent();
    } finally { loadingRef.current = false; }
  }, [editor, refreshRecent]);

  useEffect(() => {
    if (!editor || !isTauri() || startupOpenAttemptedRef.current) return;
    startupOpenAttemptedRef.current = true;
    void startupDocumentPath().then(async (startupPath) => {
      if (!startupPath) return;
      await applyLoaded(await openDocumentAtPath(startupPath));
    }).catch((caught) => setError(`无法打开由文件关联启动的文档：${String(caught)}`));
  }, [applyLoaded, editor]);

  const openFile = useCallback(async () => {
    try {
      const loaded = await chooseAndOpenDocument();
      if (!loaded) return;
      const decision = await prepareDocumentTransition();
      if (decision === 'cancel') return;
      const previousDocumentId = documentRef.current.id;
      const previousPath = pathRef.current;
      await applyLoaded(loaded);
      await commitDiscard(decision, previousDocumentId, previousPath);
    } catch (caught) { setError(`打开失败：${String(caught)}`); }
  }, [applyLoaded, commitDiscard, prepareDocumentTransition]);

  const openRecent = useCallback(async (recentPath: string) => {
    try {
      const loaded = await openDocumentAtPath(recentPath);
      const decision = await prepareDocumentTransition();
      if (decision === 'cancel') return;
      const previousDocumentId = documentRef.current.id;
      const previousPath = pathRef.current;
      await applyLoaded(loaded);
      await commitDiscard(decision, previousDocumentId, previousPath);
    } catch (caught) { setError(`无法打开最近文件：${String(caught)}`); }
  }, [applyLoaded, commitDiscard, prepareDocumentTransition]);

  const newDocument = useCallback(async () => {
    if (!editor) return;
    const decision = await prepareDocumentTransition();
    if (decision === 'cancel') return;
    const previousDocumentId = documentRef.current.id;
    const previousPath = pathRef.current;
    const created = createDocument();
    loadingRef.current = true;
    editor.commands.setContent(created.content, { emitUpdate: false });
    loadingRef.current = false;
    setDocument(created); setPath(null); setSaveState('unsaved'); setSuggestions([]); setContinuation(null); setAISummary('');
    editor.commands.setAiSuggestionDecorations([]);
    await commitDiscard(decision, previousDocumentId, previousPath);
  }, [commitDiscard, editor, prepareDocumentTransition]);

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
    const max = settingsRef.current.ai.maxContextCharacters;
    let from = forced?.from ?? selectedFrom;
    let actualTo = forced?.to ?? selectedTo;
    let selected = forced?.text ?? editor.state.doc.textBetween(from, actualTo, '
');

    if (!forced && task === 'continue' && selectedFrom === selectedTo) {
      actualTo = selectedTo;
      from = Math.max(0, actualTo - Math.min(max, 4000));
      selected = editor.state.doc.textBetween(from, actualTo, '
');
    }
    if (!selected.trim() && task !== 'continue') { setError('请先选择要分析的文字。'); return; }

    const selectedLimit = Math.max(1000, Math.floor(max * 0.4));
    if (selected.length > selectedLimit) selected = task === 'continue' ? selected.slice(-selectedLimit) : selected.slice(0, selectedLimit);
    const customInstruction = task === 'custom' ? window.prompt('请输入自定义写作要求') ?? '' : undefined;
    if (task === 'custom' && !customInstruction?.trim()) return;
    const context = createSuggestionContext(documentRef.current.id, documentRef.current.revision, from, actualTo, selected);
    const flankLimit = Math.max(400, Math.floor(max * 0.15));
    const before = editor.state.doc.textBetween(Math.max(0, from - flankLimit), from, '
');
    const after = editor.state.doc.textBetween(actualTo, Math.min(editor.state.doc.content.size, actualTo + flankLimit), '
');
    const outlineText = extractOutline(documentRef.current.content).map((item) => item.text).join(' › ');
    const chapterSummary = outlineText.length > 2000 ? `${outlineText.slice(0, 2000)}…` : outlineText;
    const fullText = editor.getText({ blockSeparator: '
' });
    const evidenceBudget = Math.max(1200, max - selected.length - (flankLimit * 2));
    const evidence = isDiagnosticTask(task) ? buildDocumentEvidence(fullText, evidenceBudget) : null;
    setAIState('running'); setAICollapsed(false);
    if (task !== 'continue') setContinuation(null);
    try {
      const response = await requestSuggestions(task, {
        selected, before, after, chapterSummary,
        documentEvidence: evidence?.text,
        scopeLabel: evidence?.scopeLabel,
        authorRules: settingsRef.current.ai.authorRules,
        customInstruction
      }, settingsRef.current, context);
      if (documentRef.current.id !== context.documentId) { setAIState('idle'); return; }
      setAISummary(evidence?.scopeLabel ? `${evidence.scopeLabel}
${response.summary}` : response.summary);
      if (task === 'continue') {
        const generated = response.fullRewrite?.trim();
        if (!generated) throw new Error('DeepSeek 没有返回可用的续写正文。');
        setSuggestions([]); editor.commands.setAiSuggestionDecorations([]);
        setContinuation({ text: generated, context });
        if (documentRef.current.revision !== context.documentRevision) setAISummary(`${response.summary}（生成期间原文已变化；此续写只能复制，不能直接插入。）`);
      } else {
        const resolved = resolveSuggestionTargets(response.suggestions, editor.state.doc, documentRef.current.id, documentRef.current.revision);
        setSuggestions(resolved); editor.commands.setAiSuggestionDecorations(resolved);
        try { await recordSuggestions(context.documentId, context.documentRevision, resolved); }
        catch (historyError) { setError(`AI 建议已生成，但本地建议元数据记录失败：${String(historyError)}`); }
      }
      setAIState('idle');
    } catch (caught) { setAIState('error'); setError(caught instanceof Error ? caught.message : String(caught)); }
  }, [editor]);

  useEffect(() => {
    const minutes = settings.ai.idleAnalysisMinutes;
    if (!editor || !shouldAutoAnalyze(minutes, document.revision > 0, editor.getText(), lastAutoHash.current)) return;
    const timer = window.setTimeout(() => {
      const fullText = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n');
      const text = recentContext(fullText, Math.min(settings.ai.maxContextCharacters, 4000));
      const hash = stableHash(text);
      if (hash === lastAutoHash.current) return;
      lastAutoHash.current = hash;
      const to = editor.state.doc.content.size;
      const offset = Math.max(0, fullText.lastIndexOf(text));
      const from = positionAtTextOffset(editor.state.doc, 0, to, offset) ?? Math.max(0, to - text.length);
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
    const current = editor.state.doc.textBetween(suggestion.targetFrom, suggestion.targetTo, '\n');
    if (isSuggestionStale(suggestion, current, documentRef.current.id, documentRef.current.revision)) {
      syncSuggestions(suggestions.map((item) => item.id === id ? { ...item, status: 'stale' } : item)); return;
    }
    try {
      await snapshot('执行 AI 替换前');
      editor.chain().focus().insertContentAt({ from: suggestion.targetFrom, to: suggestion.targetTo }, suggestion.replacement).run();
      syncSuggestions(suggestions.map((item) => item.id === id ? { ...item, status: 'accepted' } : item.status === 'pending' ? { ...item, status: 'stale' } : item));
    } catch (caught) { setError(`接受建议失败：${String(caught)}`); }
  }, [editor, snapshot, suggestions, syncSuggestions]);

  const acceptAll = useCallback(async () => {
    if (!editor) return;
    const pending = suggestions.filter((item) => item.status === 'pending' && item.targetFrom !== null && item.targetTo !== null).sort((a, b) => (b.targetFrom ?? 0) - (a.targetFrom ?? 0));
    if (!pending.length) return;
    const originalRevision = documentRef.current.revision;
    await snapshot('批量接受 AI 修改前');
    const statuses = new Map<string, AISuggestion['status']>();
    for (const suggestion of pending) {
      const current = editor.state.doc.textBetween(suggestion.targetFrom!, suggestion.targetTo!, '\n');
      if (isSuggestionStale(suggestion, current, documentRef.current.id, originalRevision)) statuses.set(suggestion.id, 'stale');
      else { editor.chain().focus().insertContentAt({ from: suggestion.targetFrom!, to: suggestion.targetTo! }, suggestion.replacement).run(); statuses.set(suggestion.id, 'accepted'); }
    }
    syncSuggestions(suggestions.map((item) => statuses.has(item.id) ? { ...item, status: statuses.get(item.id)! } : item.status === 'pending' ? { ...item, status: 'stale' } : item));
  }, [editor, snapshot, suggestions, syncSuggestions]);

  const rejectSuggestion = useCallback((id: string) => syncSuggestions(suggestions.map((item) => item.id === id ? { ...item, status: 'rejected' } : item)), [suggestions, syncSuggestions]);
  const rejectAll = useCallback(() => syncSuggestions(suggestions.map((item) => item.status === 'pending' ? { ...item, status: 'rejected' } : item)), [suggestions, syncSuggestions]);

  const insertContinuation = useCallback(async () => {
    if (!editor || !continuation) return;
    if (continuation.context.documentId !== documentRef.current.id || continuation.context.documentRevision !== documentRef.current.revision) {
      setError('生成续写后原文已经变化。为避免把旧上下文生成的内容插入新版本，请复制需要的文字或重新生成。');
      return;
    }
    try {
      const insertionPosition = continuation.context.selectionTo;
      if (insertionPosition < 1 || insertionPosition > editor.state.doc.content.size) {
        throw new Error('续写的原始插入位置已经无效，请重新生成。');
      }
      await snapshot('插入 AI 续写前');
      const paragraphs = continuation.text.split(/
+/).map((value) => value.trim()).filter(Boolean).map((value) => ({ type: 'paragraph', content: [{ type: 'text', text: value }] }));
      if (!paragraphs.length) return;
      editor.chain().focus().setTextSelection(insertionPosition).insertContent(paragraphs).run();
      setContinuation(null);
    } catch (caught) { setError(`插入续写失败：${String(caught)}`); }
  }, [continuation, editor, snapshot]);

  const findText = useCallback((query: string) => {
    if (!editor || !query) return;
    const currentDocument = editor.state.doc;
    const end = currentDocument.content.size;
    const start = editor.state.selection.to;
    const selectMatch = (rangeFrom: number, rangeTo: number, text: string): boolean => {
      const offset = text.indexOf(query);
      if (offset < 0) return false;
      const from = positionAtTextOffset(currentDocument, rangeFrom, rangeTo, offset);
      const to = positionAtTextOffset(currentDocument, rangeFrom, rangeTo, offset + query.length);
      if (from === null || to === null || from > to) return false;
      editor.chain().focus().setTextSelection({ from, to }).run();
      return true;
    };
    const rest = currentDocument.textBetween(start, end, '\n');
    if (selectMatch(start, end, rest)) return;
    const all = currentDocument.textBetween(0, end, '\n');
    if (!selectMatch(0, end, all)) setError(`未找到“${query}”`);
  }, [editor]);

  const replaceText = useCallback((query: string, replacement: string) => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (editor.state.doc.textBetween(from, to, '\n') === query) editor.chain().focus().insertContentAt({ from, to }, replacement).run();
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
    try { setVersions(await listVersions(documentInstanceKey(documentRef.current.id, pathRef.current))); setHistoryOpen(true); }
    catch (caught) { setError(`无法加载版本历史：${String(caught)}`); }
  }, []);

  const clearHistory = useCallback(async () => {
    if (!window.confirm('确定清除当前文档保存在本机 SQLite 中的全部版本快照吗？此操作不可撤销。')) return;
    try { await clearVersions(documentInstanceKey(documentRef.current.id, pathRef.current)); setVersions([]); }
    catch (caught) { setError(`清除版本历史失败：${String(caught)}`); }
  }, []);

  const restoreVersion = useCallback(async (version: VersionRecord) => {
    if (!editor) return;
    await snapshot('恢复旧版本前'); loadingRef.current = true;
    editor.commands.setContent(version.snapshot.content, { emitUpdate: false }); loadingRef.current = false;
    setDocument({ ...version.snapshot, updatedAt: new Date().toISOString(), revision: documentRef.current.revision + 1 });
    setSaveState('unsaved'); setHistoryOpen(false); setSuggestions([]); setContinuation(null); editor.commands.setAiSuggestionDecorations([]);
  }, [editor, snapshot]);

  const saveAppSettings = useCallback(async (next: AppSettings) => { await saveSettings(next); setSettingsState(next); await refreshRecent(next.general.recentFilesLimit); }, [refreshRecent]);

  const menuActions = useMemo<MenuActions>(() => ({
    newDocument: () => void newDocument(), open: () => void openFile(), save: () => void manualSave(false), saveAs: () => void manualSave(true),
    exportDocx: () => void runExport('docx'), exportTxt: () => void runExport('txt'), exportMd: () => void runExport('md'), exportHtml: () => void runExport('html'),
    find: () => setFindMode('find'), replace: () => setFindMode('replace'), settings: () => { void hasDeepSeekKey().then(setStoredKey); setSettingsOpen(true); },
    history: () => void openHistory(), toggleOutline: () => setOutlineCollapsed((value) => !value), toggleAI: () => setAICollapsed((value) => !value), print: () => window.print()
  }), [manualSave, newDocument, openFile, openHistory, runExport]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === 'n') { event.preventDefault(); void newDocument(); }
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
      <AIPanel collapsed={aiCollapsed} onToggle={() => setAICollapsed((value) => !value)} status={aiState} summary={aiSummary} suggestions={suggestions} generatedText={continuation?.text ?? null} onRun={(task) => void performAI(task)} onAccept={(id) => void acceptSuggestion(id)} onReject={rejectSuggestion} onAcceptAll={() => void acceptAll()} onRejectAll={rejectAll} onInsertGenerated={() => void insertContinuation()} onDiscardGenerated={() => setContinuation(null)} />
    </div>
    <StatusBar stats={stats} saveState={saveState} aiState={aiState} zoom={zoom} onZoom={setZoom} />
    {settingsOpen ? <SettingsDialog initial={settings} hasKey={storedKey} onClose={() => setSettingsOpen(false)} onSave={saveAppSettings} onSaveKey={async (key) => { await saveDeepSeekKey(key); setStoredKey(true); }} onDeleteKey={async () => { await deleteDeepSeekKey(); setStoredKey(false); }} onTest={testDeepSeekConnection} /> : null}
    {findMode ? <FindReplaceDialog replaceMode={findMode === 'replace'} onClose={() => setFindMode(null)} onFind={findText} onReplace={replaceText} onReplaceAll={replaceAll} /> : null}
    {historyOpen ? <HistoryDialog versions={versions} onClose={() => setHistoryOpen(false)} onRestore={(version) => void restoreVersion(version)} onClear={() => void clearHistory()} /> : null}
    {recovery ? <RecoveryDialog document={recovery.document} onRestore={() => { const recovered = recovery; if (editor) { loadingRef.current = true; editor.commands.setContent(recovered.document.content, { emitUpdate: false }); loadingRef.current = false; editor.commands.setAiSuggestionDecorations([]); } setDocument(recovered.document); setPath(null); setSaveState('unsaved'); setSuggestions([]); setContinuation(null); setAISummary(''); setRecovery(null); void writeRecovery(recovered.document, null).then(() => clearRecoveryKey(recovered.key)).catch((caught) => setError(`迁移恢复内容失败：${String(caught)}`)); }} onDiscard={() => { const discarded = recovery; void clearRecoveryKey(discarded.key).then(() => readRecovery()).then(setRecovery).catch((caught) => { setRecovery(null); setError(`清理恢复内容失败：${String(caught)}`); }); }} /> : null}
    {error ? <ErrorNotice message={error} onClose={() => setError('')} /> : null}
  </div>;
}