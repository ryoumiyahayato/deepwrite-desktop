from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8", newline="\n")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one literal match, found {count}: {old[:100]!r}")
    write(path, content.replace(old, new, 1))


def sub_once(path: str, pattern: str, replacement: str) -> None:
    content = read(path)
    updated, count = re.subn(pattern, replacement, content, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one regex match, found {count}: {pattern[:100]!r}")
    write(path, updated)


# ---------------------------------------------------------------------------
# P0 verification blocker: Rust 1.98 models HANDLE as a raw pointer.
# ---------------------------------------------------------------------------
replace_once("src-tauri/src/commands.rs", "        if handle == 0 {", "        if handle.is_null() {")

replace_once(
    "src-tauri/src/commands.rs",
    '''#[tauri::command]\npub fn read_binary(path: String) -> Result<Vec<u8>, String> {\n    fs::read(path).map_err(|e| safe_error("无法读取文件", e))\n}\n''',
    '''#[tauri::command]\npub fn read_binary(path: String) -> Result<Vec<u8>, String> {\n    fs::read(path).map_err(|e| safe_error("无法读取文件", e))\n}\n\nfn dwrite_path_from_arguments<I>(arguments: I) -> Option<String>\nwhere\n    I: IntoIterator<Item = std::ffi::OsString>,\n{\n    arguments.into_iter().find_map(|argument| {\n        let path = PathBuf::from(argument);\n        let is_dwrite = path\n            .extension()\n            .and_then(|extension| extension.to_str())\n            .is_some_and(|extension| extension.eq_ignore_ascii_case("dwrite"));\n        is_dwrite.then(|| path.to_string_lossy().into_owned())\n    })\n}\n\n#[tauri::command]\npub fn startup_document_path() -> Option<String> {\n    dwrite_path_from_arguments(std::env::args_os().skip(1))\n}\n''',
)

sub_once(
    "src-tauri/src/commands.rs",
    r'''#\[tauri::command\]\npub fn read_recovery\(app: AppHandle\) -> Result<Option<String>, String> \{.*?\n\}\n\n#\[tauri::command\]\npub fn clear_recovery''',
    '''#[derive(Debug, Serialize)]\n#[serde(rename_all = "camelCase")]\npub struct RecoveryPayload {\n    pub key: String,\n    pub contents: String,\n}\n\nfn recovery_key_from_path(path: &Path) -> Option<String> {\n    let encoded = path.file_stem()?.to_str()?;\n    String::from_utf8(hex::decode(encoded).ok()?).ok()\n}\n\n#[tauri::command]\npub fn read_recovery(app: AppHandle) -> Result<Option<RecoveryPayload>, String> {\n    let directory = recovery_dir(&app)?;\n    if !directory.exists() {\n        return Ok(None);\n    }\n\n    let mut candidates: Vec<(SystemTime, PathBuf)> = fs::read_dir(&directory)\n        .map_err(|e| safe_error("无法读取恢复目录", e))?\n        .filter_map(Result::ok)\n        .filter_map(|entry| {\n            let path = entry.path();\n            if path.extension().and_then(|value| value.to_str()) != Some("dwrite") {\n                return None;\n            }\n            let modified = entry\n                .metadata()\n                .ok()\n                .and_then(|metadata| metadata.modified().ok())\n                .unwrap_or(SystemTime::UNIX_EPOCH);\n            Some((modified, path))\n        })\n        .collect();\n    candidates.sort_by(|left, right| right.0.cmp(&left.0));\n\n    for (_, path) in candidates {\n        if let Ok(contents) = fs::read_to_string(&path) {\n            if recovery_document_id(&contents).is_some() {\n                if let Some(key) = recovery_key_from_path(&path) {\n                    return Ok(Some(RecoveryPayload { key, contents }));\n                }\n            }\n        }\n    }\n    Ok(None)\n}\n\n#[tauri::command]\npub fn clear_recovery''',
)

sub_once(
    "src-tauri/src/commands.rs",
    r'''(    #\[test\]\n    fn conditional_write_creates_only_when_target_is_still_missing\(\) \{.*?\n    \}\n)(\})\s*$''',
    r'''\1\n    #[test]\n    fn startup_document_argument_accepts_only_dwrite_paths() {\n        let args = vec![\n            std::ffi::OsString::from("notes.txt"),\n            std::ffi::OsString::from(r"C:\\Drafts\\novel.dwrite"),\n        ];\n        assert_eq!(\n            dwrite_path_from_arguments(args).as_deref(),\n            Some(r"C:\\Drafts\\novel.dwrite")\n        );\n        assert!(dwrite_path_from_arguments(vec![std::ffi::OsString::from("notes.md")]).is_none());\n    }\n\2\n''',
)

# ---------------------------------------------------------------------------
# P1: physical document instance identity (path-scoped recovery/history).
# ---------------------------------------------------------------------------
write(
    "src/domain/documentIdentity.ts",
    r'''export function normalizeDocumentPath(path: string): string {
  return path.trim().replace(/\//g, '\\').replace(/\\+/g, '\\').toLocaleLowerCase('en-US');
}

function pathFingerprint(path: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

export function documentInstanceKey(documentId: string, path: string | null): string {
  if (!path?.trim()) return documentId;
  return `${documentId}@${pathFingerprint(normalizeDocumentPath(path))}`;
}
''',
)

write(
    "src/domain/documentIdentity.test.ts",
    r'''import { describe, expect, it } from 'vitest';
import { documentInstanceKey, normalizeDocumentPath } from './documentIdentity';

describe('document physical instance identity', () => {
  it('normalizes Windows path spelling consistently', () => {
    expect(normalizeDocumentPath('C:/Books//Draft.dwrite')).toBe('c:\\books\\draft.dwrite');
  });

  it('separates hand-copied files that retain the same embedded document id', () => {
    const original = documentInstanceKey('doc-1', 'C:\\Books\\Draft.dwrite');
    const copy = documentInstanceKey('doc-1', 'C:\\Books\\Draft Copy.dwrite');
    expect(original).not.toBe(copy);
    expect(documentInstanceKey('doc-1', null)).toBe('doc-1');
  });
});
''',
)

write(
    "src/services/documentFiles.ts",
    r'''import type { JSONContent } from '@tiptap/core';
import { marked } from 'marked';
import TurndownService from 'turndown';
import {
  createDocument,
  forkDocumentForSaveAs,
  parseDocument,
  serializeDocument,
  type DeepWriteDocument
} from '../domain/document';
import { documentInstanceKey, normalizeDocumentPath } from '../domain/documentIdentity';
import {
  atomicWriteBinary,
  atomicWriteText,
  chooseOpenPath,
  chooseSavePath,
  compareAndSwapText,
  extensionFromPath,
  fileNameFromPath,
  invokeCommand,
  readBinary,
  readText,
  readTextIfExists
} from './platform';

export type ImportedContent =
  | { kind: 'document'; document: DeepWriteDocument; path: string; diskContents: string; warnings: string[] }
  | { kind: 'html'; html: string; title: string; sourcePath: string; warnings: string[] };

export interface SavedDwrite {
  path: string;
  document: DeepWriteDocument;
  diskContents: string;
}

export interface RecoveredDwrite {
  key: string;
  document: DeepWriteDocument;
}

interface RecoveryPayload {
  key: string;
  contents: string;
}

const diskBaselines = new Map<string, string>();
const htmlEscape = (input: string) => input.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);

function suggestedPath(directory: string, fileName: string): string {
  const trimmed = directory.trim().replace(/[\\/]+$/, '');
  return trimmed ? `${trimmed}\\${fileName}` : fileName;
}

export function sameDocumentPath(left: string | null, right: string | null): boolean {
  return Boolean(left && right && normalizeDocumentPath(left) === normalizeDocumentPath(right));
}

export async function chooseAndOpenDocument(): Promise<ImportedContent | null> {
  const path = await chooseOpenPath(['dwrite', 'docx', 'txt', 'md', 'html', 'htm'], '写作文档');
  return path ? openDocumentAtPath(path) : null;
}

export async function openDocumentAtPath(path: string): Promise<ImportedContent> {
  const extension = extensionFromPath(path);
  if (extension === 'dwrite') {
    const diskContents = await readText(path);
    diskBaselines.set(normalizeDocumentPath(path), diskContents);
    return { kind: 'document', document: parseDocument(diskContents), path, diskContents, warnings: [] };
  }
  if (extension === 'docx') {
    const { importDocx } = await import('./docx');
    const imported = await importDocx(await readBinary(path));
    return { kind: 'html', html: imported.html, title: fileNameFromPath(path).replace(/\.docx$/i, ''), sourcePath: path, warnings: imported.warnings };
  }
  const text = await readText(path);
  if (extension === 'txt') {
    const html = text.split(/\r?\n/).map((line) => `<p>${htmlEscape(line) || '<br>'}</p>`).join('');
    return { kind: 'html', html, title: fileNameFromPath(path).replace(/\.txt$/i, ''), sourcePath: path, warnings: [] };
  }
  if (extension === 'md') return { kind: 'html', html: await marked.parse(text), title: fileNameFromPath(path).replace(/\.md$/i, ''), sourcePath: path, warnings: [] };
  if (extension === 'html' || extension === 'htm') return { kind: 'html', html: text, title: fileNameFromPath(path).replace(/\.html?$/i, ''), sourcePath: path, warnings: [] };
  throw new Error(`不支持的文件类型：.${extension}`);
}

export async function saveDwrite(
  document: DeepWriteDocument,
  currentPath: string | null,
  saveAs = false,
  defaultDirectory = ''
): Promise<SavedDwrite | null> {
  let path = saveAs ? null : currentPath;
  if (!path) path = await chooseSavePath(suggestedPath(defaultDirectory, `${document.title || '未命名文档'}.dwrite`), ['dwrite'], 'DeepWrite 文档');
  if (!path) return null;

  const writingCurrentPath = sameDocumentPath(path, currentPath);
  const isFork = saveAs && Boolean(currentPath) && !writingCurrentPath;
  const savedDocument = isFork ? forkDocumentForSaveAs(document) : document;
  const key = normalizeDocumentPath(path);
  const targetBaseline = writingCurrentPath
    ? (diskBaselines.get(key) ?? null)
    : await readTextIfExists(path);
  const diskContents = serializeDocument(savedDocument);
  await compareAndSwapText(path, targetBaseline, diskContents);
  diskBaselines.set(key, diskContents);
  return { path, document: savedDocument, diskContents };
}

export async function exportDocument(
  format: 'docx' | 'txt' | 'md' | 'html',
  title: string,
  content: JSONContent,
  html: string,
  text: string,
  defaultDirectory = ''
): Promise<string | null> {
  const path = await chooseSavePath(suggestedPath(defaultDirectory, `${title}.${format}`), [format], format.toUpperCase());
  if (!path) return null;
  if (format === 'docx') {
    const { exportDocx } = await import('./docx');
    await atomicWriteBinary(path, await exportDocx(content, title));
  }
  else if (format === 'txt') await atomicWriteText(path, text);
  else if (format === 'html') await atomicWriteText(path, `<!doctype html><meta charset="utf-8"><title>${htmlEscape(title)}</title><article>${html}</article>`);
  else {
    const converter = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
    await atomicWriteText(path, `${converter.turndown(html)}\n`);
  }
  return path;
}

export async function writeRecovery(document: DeepWriteDocument, path: string | null): Promise<void> {
  await invokeCommand('write_recovery', {
    documentId: documentInstanceKey(document.id, path),
    contents: serializeDocument(document)
  });
}

export async function readRecovery(): Promise<RecoveredDwrite | null> {
  const payload = await invokeCommand<RecoveryPayload | null>('read_recovery');
  if (!payload) return null;
  return { key: payload.key, document: parseDocument(payload.contents) };
}

export async function clearRecovery(documentId: string, path: string | null): Promise<void> {
  await clearRecoveryKey(documentInstanceKey(documentId, path));
}

export async function clearRecoveryKey(key: string): Promise<void> {
  await invokeCommand('clear_recovery', { documentId: key });
}

export async function startupDocumentPath(): Promise<string | null> {
  return invokeCommand<string | null>('startup_document_path');
}

export function importedHtmlDocument(title: string, content: JSONContent): DeepWriteDocument {
  return { ...createDocument(title), content, revision: 1, metadata: { importedAt: new Date().toISOString() } };
}
''',
)

# ---------------------------------------------------------------------------
# P1: bounded but explicit document evidence for consistency diagnostics.
# ---------------------------------------------------------------------------
write(
    "src/domain/aiEvidence.ts",
    r'''export interface DocumentEvidence {
  text: string;
  scopeLabel: string;
  complete: boolean;
}

export function buildDocumentEvidence(fullText: string, maxChars: number): DocumentEvidence {
  const text = fullText.trim();
  const budget = Math.max(1200, Math.floor(maxChars));
  if (text.length <= budget) {
    return { text, scopeLabel: '分析范围：当前文档全文。', complete: true };
  }

  const segments = 5;
  const separator = '\n…[文档抽样分隔]…\n';
  const usable = Math.max(segments * 80, budget - separator.length * (segments - 1));
  const chunkSize = Math.max(80, Math.floor(usable / segments));
  const maxStart = Math.max(0, text.length - chunkSize);
  const parts = Array.from({ length: segments }, (_, index) => {
    const ratio = segments === 1 ? 0 : index / (segments - 1);
    const start = Math.min(maxStart, Math.floor(maxStart * ratio));
    return text.slice(start, start + chunkSize);
  });
  return {
    text: parts.join(separator).slice(0, budget),
    scopeLabel: '分析范围：文档超过上下文预算，已按全文位置均匀抽样；未覆盖部分不能据此判定不存在矛盾或人物偏差。',
    complete: false
  };
}
''',
)

write(
    "src/domain/aiEvidence.test.ts",
    r'''import { describe, expect, it } from 'vitest';
import { buildDocumentEvidence } from './aiEvidence';

describe('document evidence budgeting', () => {
  it('uses the full document when it fits', () => {
    const result = buildDocumentEvidence('完整短文', 2000);
    expect(result.complete).toBe(true);
    expect(result.text).toBe('完整短文');
    expect(result.scopeLabel).toContain('全文');
  });

  it('samples across an oversized document and discloses the limitation', () => {
    const source = Array.from({ length: 1000 }, (_, index) => `段落${index}`).join('\n');
    const result = buildDocumentEvidence(source, 1600);
    expect(result.complete).toBe(false);
    expect(result.text.length).toBeLessThanOrEqual(1600);
    expect(result.text).toContain('段落0');
    expect(result.text).toContain('段落999');
    expect(result.scopeLabel).toContain('未覆盖');
  });
});
''',
)

write(
    "src/services/deepseek.ts",
    r'''import type { AppSettings } from '../domain/settings';
import {
  aiResponseSchema,
  attachSuggestionContext,
  type AIResponse,
  type AISuggestion,
  type SuggestionContext
} from '../domain/ai';
import { invokeCommand } from './platform';
import { readDeepSeekKey } from './secrets';

export type AITask = 'proofread' | 'light-polish' | 'deep-polish' | 'shorten' | 'expand' | 'rewrite' | 'logic' | 'contradiction' | 'character' | 'continue' | 'custom' | 'auto';

const diagnosticTasks = new Set<AITask>(['logic', 'contradiction', 'character']);
export function isDiagnosticTask(task: AITask): boolean { return diagnosticTasks.has(task); }

const taskInstructions: Record<AITask, string> = {
  proofread: '校对错别字、语法、标点和明显用词问题，尽量少改。',
  'light-polish': '轻度润色，保留叙事声音、节奏和句式特征。',
  'deep-polish': '深度润色表达，但不要改变事实、人物动机和叙事视角。',
  shorten: '精简冗余表达，保留信息与语气。',
  expand: '在不引入无根据事实的前提下扩写细节与感受。',
  rewrite: '提供质量更高的重写方案，并解释关键变化。',
  logic: '只在提供的证据范围内检查因果、动机、时间顺序和论证逻辑；证据不足时明确说明。',
  contradiction: '只在提供的证据范围内检查前后矛盾；不得把未覆盖内容推断为不存在矛盾。',
  character: '只在提供的证据范围内检查人物身份、语气、行为与已知设定是否一致；证据不足时明确说明。',
  continue: '根据上下文继续写作，保持叙事视角与文风。',
  custom: '严格执行用户给出的自定义要求。',
  auto: '只指出近期修改中值得注意的语法、清晰度、逻辑或一致性问题。'
};

export interface AIContextInput {
  selected: string;
  before: string;
  after: string;
  chapterSummary: string;
  authorRules: string;
  documentEvidence?: string;
  scopeLabel?: string;
  customInstruction?: string;
}

function promptFor(task: AITask, context: AIContextInput, repair = false): string {
  const repairInstruction = repair ? '\n上一次返回未通过 schema 校验。只返回一个严格有效的 JSON 对象，不要 Markdown。' : '';
  const evidence = context.documentEvidence
    ? `\n${context.scopeLabel || '分析范围：提供的文档证据。'}\n【文档证据】\n${context.documentEvidence}\n【文档证据结束】\n`
    : '';
  const common = `你是中文长篇写作编辑。任务：${taskInstructions[task]}
${context.customInstruction ? `自定义要求：${context.customInstruction}` : ''}
作者规则：
${context.authorRules || '无'}

章节/结构索引：${context.chapterSummary || '未提供'}${evidence}
前文：${context.before || '无'}
【目标原文】
${context.selected}
【目标结束】
后文：${context.after || '无'}\n`;

  if (task === 'continue') {
    return `${common}
必须返回 JSON 对象，且只有以下字段：
{"summary":"string","suggestions":[],"fullRewrite":"只包含新续写正文，不要重复目标原文"}
续写内容放在 fullRewrite；suggestions 必须为空数组。不要把续写伪装成替换建议。${repairInstruction}`;
  }

  if (isDiagnosticTask(task)) {
    return `${common}
这是诊断任务，不是改写任务。必须返回 JSON 对象，且只有以下字段：
{"summary":"用清晰的条目化文字列出发现、证据位置与不确定性；没有问题也要说明检查范围","suggestions":[],"fullRewrite":null}
不得为了满足格式而制造 replacement；suggestions 必须为空数组。${repairInstruction}`;
  }

  return `${common}
必须返回 JSON 对象，且只有以下字段：
{"summary":"string","suggestions":[{"id":"string","type":"grammar|clarity|style|logic|rewrite|other","severity":"minor|medium|major","original":"必须逐字且唯一地出现在目标原文中，并限制在单一段落内，不得包含换行","replacement":"string","reason":"string"}],"fullRewrite":null}
不要把建议直接应用到原文。不要为重复出现而无法唯一定位的原文生成可替换建议。没有问题时 suggestions 返回空数组。${repairInstruction}`;
}

function extractContent(response: unknown): string {
  const value = response as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = value.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('DeepSeek 响应缺少 message.content。');
  return content;
}

function parseValidated(content: string): AIResponse {
  let parsed: unknown;
  try { parsed = JSON.parse(content); }
  catch { throw new Error('DeepSeek 返回的内容不是有效 JSON。'); }
  const result = aiResponseSchema.safeParse(parsed);
  if (!result.success) throw new Error(`AI 响应结构无效：${result.error.issues[0]?.message ?? '未知错误'}`);
  return result.data;
}

async function rawRequest(apiKey: string, model: string, prompt: string) {
  return invokeCommand<unknown>('call_deepseek', {
    request: {
      apiKey,
      model,
      messages: [{ role: 'system', content: 'Return strict JSON only.' }, { role: 'user', content: prompt }],
      maxTokens: 4096,
      responseFormat: { type: 'json_object' }
    }
  });
}

export async function requestSuggestions(
  task: AITask,
  input: AIContextInput,
  settings: AppSettings,
  context: SuggestionContext
): Promise<{ summary: string; suggestions: AISuggestion[]; fullRewrite: string | null }> {
  const apiKey = await readDeepSeekKey();
  if (!apiKey) throw new Error('请先在“设置 → AI → DeepSeek”中保存 API Key。');
  const deepTasks: AITask[] = ['deep-polish', 'logic', 'contradiction', 'character', 'rewrite'];
  const model = deepTasks.includes(task) ? settings.ai.deepModel : settings.ai.fastModel;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await rawRequest(apiKey, model, promptFor(task, input, attempt === 1));
      const validated = parseValidated(extractContent(raw));
      if (task === 'continue' && (!validated.fullRewrite?.trim() || validated.suggestions.length > 0)) {
        throw new Error('续写响应必须只包含 fullRewrite，且 suggestions 为空。');
      }
      if (task !== 'continue' && validated.fullRewrite !== null) {
        throw new Error('非续写任务不应返回 fullRewrite。');
      }
      if (isDiagnosticTask(task) && validated.suggestions.length > 0) {
        throw new Error('诊断任务只能返回分析发现，不应生成可执行替换建议。');
      }
      return { ...validated, suggestions: attachSuggestionContext(validated, context) };
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error('AI 响应校验失败。');
}

export async function testDeepSeekConnection(model: string, enteredKey?: string) {
  const apiKey = enteredKey?.trim() || await readDeepSeekKey();
  if (!apiKey) return { success: false, message: '请先填写或保存 API Key' };
  return invokeCommand<{ success: boolean; message: string }>('test_deepseek', { apiKey, model });
}
''',
)

write(
    "src/components/AIPanel.tsx",
    r'''import { Check, ChevronLeft, ChevronRight, Clipboard, FilePlus2, LoaderCircle, Sparkles, X } from 'lucide-react';
import type { AISuggestion } from '../domain/ai';
import type { AITask } from '../services/deepseek';

const tasks: Array<{ id: AITask; label: string }> = [
  { id: 'proofread', label: '校对' }, { id: 'light-polish', label: '轻度润色' },
  { id: 'deep-polish', label: '深度润色' }, { id: 'shorten', label: '精简' },
  { id: 'expand', label: '扩写' }, { id: 'rewrite', label: '重写' },
  { id: 'logic', label: '检查逻辑' }, { id: 'contradiction', label: '前后矛盾' },
  { id: 'character', label: '人物一致性' }, { id: 'continue', label: '继续写作' },
  { id: 'custom', label: '自定义要求' }
];

const severityLabels = { minor: '轻微', medium: '中等', major: '重要' };
const statusLabels = { pending: '待处理', accepted: '已接受', rejected: '已拒绝', stale: '已过期 / 原文已变化' };

export function AIPanel({ collapsed, onToggle, status, summary, suggestions, generatedText, onRun, onAccept, onReject, onAcceptAll, onRejectAll, onInsertGenerated, onDiscardGenerated }: {
  collapsed: boolean; onToggle: () => void; status: 'idle' | 'running' | 'error'; summary: string;
  suggestions: AISuggestion[]; generatedText: string | null; onRun: (task: AITask) => void; onAccept: (id: string) => void; onReject: (id: string) => void;
  onAcceptAll: () => void; onRejectAll: () => void; onInsertGenerated: () => void; onDiscardGenerated: () => void;
}) {
  if (collapsed) return <aside className="ai-panel collapsed"><button className="rail-toggle" onClick={onToggle} title="展开 AI 建议"><ChevronLeft /></button><Sparkles /></aside>;
  const pending = suggestions.filter((item) => item.status === 'pending').length;
  return <aside className="ai-panel">
    <div className="panel-heading"><strong><Sparkles />AI 建议</strong><button onClick={onToggle} title="折叠 AI 建议"><ChevronRight /></button></div>
    <div className="ai-task-section"><div className="section-label">选中文字后执行</div><div className="task-grid">{tasks.map((task) => <button key={task.id} disabled={status === 'running'} onClick={() => onRun(task.id)}>{task.label}</button>)}</div></div>
    <div className={`ai-progress ${status}`} aria-live="polite">{status === 'running' ? <><LoaderCircle className="spin" />正在请求 DeepSeek…</> : status === 'error' ? 'AI 请求失败，请查看错误信息。' : <><span className="status-dot" />AI 就绪</>}</div>
    {summary ? <div className="ai-summary"><strong>分析摘要</strong><p style={{ whiteSpace: 'pre-wrap' }}>{summary}</p></div> : null}
    {generatedText ? <div className="ai-summary"><strong>续写草稿</strong><p style={{ whiteSpace: 'pre-wrap' }}>{generatedText}</p><div className="suggestion-actions"><button onClick={() => navigator.clipboard.writeText(generatedText)}><Clipboard />复制</button><button onClick={onDiscardGenerated}><X />放弃</button><button className="accept" onClick={onInsertGenerated}><FilePlus2 />插入生成位置</button></div></div> : null}
    <div className="suggestion-actions"><span>{pending} 条待处理</span><div><button disabled={!pending} onClick={onAcceptAll}><Check />全部接受</button><button disabled={!pending} onClick={onRejectAll}><X />全部拒绝</button></div></div>
    <div className="suggestion-list">
      {suggestions.length ? suggestions.map((suggestion, index) => <article key={suggestion.id} className={`suggestion-card ${suggestion.status}`}>
        <header><span>建议 {index + 1}</span><span className={`severity ${suggestion.severity}`}>{severityLabels[suggestion.severity]}</span></header>
        {suggestion.status !== 'pending' ? <div className="suggestion-status">{statusLabels[suggestion.status]}</div> : null}
        <div className="diff-block"><span className="diff-label">原文 / 建议删除</span><del>{suggestion.original || '（空）'}</del></div>
        <div className="diff-block"><span className="diff-label">建议 / 新增</span><ins>{suggestion.replacement || '（删除此处）'}</ins></div>
        <div className="reason"><strong>修改原因</strong><p>{suggestion.reason}</p></div>
        <footer>
          <button title="复制建议文本" onClick={() => navigator.clipboard.writeText(suggestion.replacement)}><Clipboard /></button>
          <span />
          <button disabled={suggestion.status !== 'pending'} className="accept" onClick={() => onAccept(suggestion.id)}><Check />接受</button>
          <button disabled={suggestion.status !== 'pending'} onClick={() => onReject(suggestion.id)}><X />拒绝</button>
        </footer>
      </article>) : generatedText ? null : <div className="ai-empty"><Sparkles /><p>选择文本后运行改写任务，或运行诊断任务查看分析摘要。AI 不会自动覆盖原文。</p></div>}
    </div>
  </aside>;
}
''',
)

# ---------------------------------------------------------------------------
# P1: App integration — scoped identity, diagnostics, continuation anchor,
# startup file association.
# ---------------------------------------------------------------------------
replace_once(
    "src/App.tsx",
    "import { createSuggestionContext, isSuggestionStale, stableHash, type AISuggestion, type SuggestionContext } from './domain/ai';\n",
    "import { createSuggestionContext, isSuggestionStale, stableHash, type AISuggestion, type SuggestionContext } from './domain/ai';\nimport { buildDocumentEvidence } from './domain/aiEvidence';\nimport { documentInstanceKey } from './domain/documentIdentity';\n",
)
replace_once(
    "src/App.tsx",
    "import { requestSuggestions, testDeepSeekConnection, type AITask } from './services/deepseek';",
    "import { isDiagnosticTask, requestSuggestions, testDeepSeekConnection, type AITask } from './services/deepseek';",
)
replace_once(
    "src/App.tsx",
    "  chooseAndOpenDocument,\n  clearRecovery,\n  exportDocument,\n  openDocumentAtPath,\n  readRecovery,\n  saveDwrite,\n  writeRecovery,\n  type ImportedContent\n",
    "  chooseAndOpenDocument,\n  clearRecovery,\n  clearRecoveryKey,\n  exportDocument,\n  openDocumentAtPath,\n  readRecovery,\n  saveDwrite,\n  startupDocumentPath,\n  writeRecovery,\n  type ImportedContent,\n  type RecoveredDwrite\n",
)
replace_once(
    "src/App.tsx",
    "    id: crypto.randomUUID(), documentId: document.id, documentPath: path,",
    "    id: crypto.randomUUID(), documentId: documentInstanceKey(document.id, path), documentPath: path,",
)
replace_once("src/App.tsx", "  const [recovery, setRecovery] = useState<DeepWriteDocument | null>(null);", "  const [recovery, setRecovery] = useState<RecoveredDwrite | null>(null);")
replace_once("src/App.tsx", "  const lastAutoHash = useRef<string | null>(null);", "  const lastAutoHash = useRef<string | null>(null);\n  const startupOpenAttemptedRef = useRef(false);")
replace_once("src/App.tsx", "        await writeRecovery(current);", "        await writeRecovery(current, pathRef.current);")
replace_once("src/App.tsx", "            await clearRecovery(current.id);", "            await clearRecovery(current.id, pathRef.current);")
replace_once(
    "src/App.tsx",
    "    const source = { ...documentRef.current, content: editor.getJSON(), updatedAt: new Date().toISOString() };\n    setSaveState('saving');",
    "    const source = { ...documentRef.current, content: editor.getJSON(), updatedAt: new Date().toISOString() };\n    const sourcePath = pathRef.current;\n    setSaveState('saving');",
)
replace_once("src/App.tsx", "      const saved = await saveDwrite(source, pathRef.current, saveAs, settingsRef.current.general.defaultSaveDirectory);", "      const saved = await saveDwrite(source, sourcePath, saveAs, settingsRef.current.general.defaultSaveDirectory);")
replace_once("src/App.tsx", "      await clearRecovery(source.id);", "      await clearRecovery(source.id, sourcePath);")
replace_once("src/App.tsx", "      try { await writeRecovery(source); } catch { /* keep the original save error */ }", "      try { await writeRecovery(source, sourcePath); } catch { /* keep the original save error */ }")
replace_once(
    "src/App.tsx",
    "  const commitDiscard = useCallback(async (decision: TransitionDecision, documentId: string) => {\n    if (decision !== 'discard') return;\n    try { await clearRecovery(documentId); }\n    catch (caught) { setError(`已切换文档，但无法清理被放弃文档的恢复副本：${String(caught)}`); }\n  }, []);",
    "  const commitDiscard = useCallback(async (decision: TransitionDecision, documentId: string, documentPath: string | null) => {\n    if (decision !== 'discard') return;\n    try { await clearRecovery(documentId, documentPath); }\n    catch (caught) { setError(`已切换文档，但无法清理被放弃文档的恢复副本：${String(caught)}`); }\n  }, []);",
)
replace_once("src/App.tsx", "          try { await clearRecovery(documentRef.current.id); }", "          try { await clearRecovery(documentRef.current.id, pathRef.current); }")
replace_once(
    "src/App.tsx",
    "      const previousDocumentId = documentRef.current.id;\n      await applyLoaded(loaded);\n      await commitDiscard(decision, previousDocumentId);",
    "      const previousDocumentId = documentRef.current.id;\n      const previousPath = pathRef.current;\n      await applyLoaded(loaded);\n      await commitDiscard(decision, previousDocumentId, previousPath);",
)
# The same three-line block exists in openRecent after the first replacement.
replace_once(
    "src/App.tsx",
    "      const previousDocumentId = documentRef.current.id;\n      await applyLoaded(loaded);\n      await commitDiscard(decision, previousDocumentId);",
    "      const previousDocumentId = documentRef.current.id;\n      const previousPath = pathRef.current;\n      await applyLoaded(loaded);\n      await commitDiscard(decision, previousDocumentId, previousPath);",
)
replace_once(
    "src/App.tsx",
    "    const previousDocumentId = documentRef.current.id;\n    const created = createDocument();",
    "    const previousDocumentId = documentRef.current.id;\n    const previousPath = pathRef.current;\n    const created = createDocument();",
)
replace_once("src/App.tsx", "    await commitDiscard(decision, previousDocumentId);", "    await commitDiscard(decision, previousDocumentId, previousPath);")

replace_once(
    "src/App.tsx",
    "  }, [editor, refreshRecent]);\n\n  const openFile = useCallback(async () => {",
    "  }, [editor, refreshRecent]);\n\n  useEffect(() => {\n    if (!editor || !isTauri() || startupOpenAttemptedRef.current) return;\n    startupOpenAttemptedRef.current = true;\n    void startupDocumentPath().then(async (startupPath) => {\n      if (!startupPath) return;\n      await applyLoaded(await openDocumentAtPath(startupPath));\n    }).catch((caught) => setError(`无法打开由文件关联启动的文档：${String(caught)}`));\n  }, [applyLoaded, editor]);\n\n  const openFile = useCallback(async () => {",
)

sub_once(
    "src/App.tsx",
    r'''  const performAI = useCallback\(async \(task: AITask, forced\?: \{ from: number; to: number; text: string \}\) => \{.*?\n  \}, \[editor\]\);\n\n  useEffect\(\(\) => \{\n    const minutes = settings\.ai\.idleAnalysisMinutes;''',
    r'''  const performAI = useCallback(async (task: AITask, forced?: { from: number; to: number; text: string }) => {
    if (!editor) return;
    const { from: selectedFrom, to: selectedTo } = editor.state.selection;
    const max = settingsRef.current.ai.maxContextCharacters;
    let from = forced?.from ?? selectedFrom;
    let actualTo = forced?.to ?? selectedTo;
    let selected = forced?.text ?? editor.state.doc.textBetween(from, actualTo, '\n');

    if (!forced && task === 'continue' && selectedFrom === selectedTo) {
      actualTo = selectedTo;
      from = Math.max(0, actualTo - Math.min(max, 4000));
      selected = editor.state.doc.textBetween(from, actualTo, '\n');
    }
    if (!selected.trim() && task !== 'continue') { setError('请先选择要分析的文字。'); return; }

    const selectedLimit = Math.max(1000, Math.floor(max * 0.4));
    if (selected.length > selectedLimit) selected = task === 'continue' ? selected.slice(-selectedLimit) : selected.slice(0, selectedLimit);
    const customInstruction = task === 'custom' ? window.prompt('请输入自定义写作要求') ?? '' : undefined;
    if (task === 'custom' && !customInstruction?.trim()) return;
    const context = createSuggestionContext(documentRef.current.id, documentRef.current.revision, from, actualTo, selected);
    const flankLimit = Math.max(400, Math.floor(max * 0.15));
    const before = editor.state.doc.textBetween(Math.max(0, from - flankLimit), from, '\n');
    const after = editor.state.doc.textBetween(actualTo, Math.min(editor.state.doc.content.size, actualTo + flankLimit), '\n');
    const outlineText = extractOutline(documentRef.current.content).map((item) => item.text).join(' › ');
    const chapterSummary = outlineText.length > 2000 ? `${outlineText.slice(0, 2000)}…` : outlineText;
    const fullText = editor.getText({ blockSeparator: '\n' });
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
      setAISummary(evidence?.scopeLabel ? `${evidence.scopeLabel}\n${response.summary}` : response.summary);
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
    const minutes = settings.ai.idleAnalysisMinutes;''',
)

sub_once(
    "src/App.tsx",
    r'''  const insertContinuation = useCallback\(async \(\) => \{.*?\n  \}, \[continuation, editor, snapshot\]\);\n\n  const findText''',
    r'''  const insertContinuation = useCallback(async () => {
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
      const paragraphs = continuation.text.split(/\n+/).map((value) => value.trim()).filter(Boolean).map((value) => ({ type: 'paragraph', content: [{ type: 'text', text: value }] }));
      if (!paragraphs.length) return;
      editor.chain().focus().setTextSelection(insertionPosition).insertContent(paragraphs).run();
      setContinuation(null);
    } catch (caught) { setError(`插入续写失败：${String(caught)}`); }
  }, [continuation, editor, snapshot]);

  const findText''',
)

replace_once("src/App.tsx", "    try { setVersions(await listVersions(documentRef.current.id)); setHistoryOpen(true); }", "    try { setVersions(await listVersions(documentInstanceKey(documentRef.current.id, pathRef.current))); setHistoryOpen(true); }")
replace_once("src/App.tsx", "    try { await clearVersions(documentRef.current.id); setVersions([]); }", "    try { await clearVersions(documentInstanceKey(documentRef.current.id, pathRef.current)); setVersions([]); }")

replace_once(
    "src/App.tsx",
    "    {recovery ? <RecoveryDialog document={recovery} onRestore={() => { if (editor) { loadingRef.current = true; editor.commands.setContent(recovery.content, { emitUpdate: false }); loadingRef.current = false; editor.commands.setAiSuggestionDecorations([]); } setDocument(recovery); setPath(null); setSaveState('unsaved'); setSuggestions([]); setContinuation(null); setAISummary(''); setRecovery(null); }} onDiscard={() => { const discarded = recovery; void clearRecovery(discarded.id).then(() => readRecovery()).then(setRecovery).catch((caught) => { setRecovery(null); setError(`清理恢复内容失败：${String(caught)}`); }); }} /> : null}",
    "    {recovery ? <RecoveryDialog document={recovery.document} onRestore={() => { const recovered = recovery; if (editor) { loadingRef.current = true; editor.commands.setContent(recovered.document.content, { emitUpdate: false }); loadingRef.current = false; editor.commands.setAiSuggestionDecorations([]); } setDocument(recovered.document); setPath(null); setSaveState('unsaved'); setSuggestions([]); setContinuation(null); setAISummary(''); setRecovery(null); void writeRecovery(recovered.document, null).then(() => clearRecoveryKey(recovered.key)).catch((caught) => setError(`迁移恢复内容失败：${String(caught)}`)); }} onDiscard={() => { const discarded = recovery; void clearRecoveryKey(discarded.key).then(() => readRecovery()).then(setRecovery).catch((caught) => { setRecovery(null); setError(`清理恢复内容失败：${String(caught)}`); }); }} /> : null}",
)

# ---------------------------------------------------------------------------
# P1: register startup file-association command.
# ---------------------------------------------------------------------------
write(
    "src-tauri/src/lib.rs",
    r'''mod commands;

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
''',
)

print("P1 autofix applied successfully")
