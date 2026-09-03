from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one guarded match, found {count}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


# 1. Full-document diagnosis disclosure and immutable plan.
Path("src/services/diagnostics.ts").write_text("""import { buildDocumentEvidenceBatches, type DocumentEvidence } from '../domain/aiEvidence';
import type { SuggestionContext } from '../domain/ai';
import type { AppSettings } from '../domain/settings';
import { isDiagnosticTask, requestSuggestions, type AITask, type AIContextInput } from './deepseek';

export interface FullDocumentDiagnosticDisclosure {
  characterCount: number;
  requestCount: number;
  message: string;
}

export interface FullDocumentDiagnosticPlan {
  batches: DocumentEvidence[];
  disclosure: FullDocumentDiagnosticDisclosure;
}

export function buildFullDocumentDiagnosticPlan(fullText: string, evidenceBudget: number): FullDocumentDiagnosticPlan {
  const batches = buildDocumentEvidenceBatches(fullText, evidenceBudget);
  const characterCount = fullText.trim().length;
  const requestCount = batches.length;
  return {
    batches,
    disclosure: {
      characterCount,
      requestCount,
      message: [
        '全文诊断隐私提示',
        `此操作会把当前文档全文（约 ${characterCount} 个字符）分成 ${requestCount} 个有重叠的请求批次发送给你配置的 DeepSeek API。`,
        '每个批次还可能包含作者规则、章节标题摘要，以及当前选区或光标附近的有限上下文。',
        'DeepWrite 不会把这些请求正文写入 AI 建议历史，也不会把文档发送给项目维护者。DeepSeek 对收到数据的处理受你的 API 账户及其服务条款约束。',
        '只有点击“确定”才会开始发送全文诊断请求。'
      ].join('\\n\\n')
    }
  };
}

export interface DiagnosticRunInput {
  task: AITask;
  fullText: string;
  evidenceBudget: number;
  baseContext: Omit<AIContextInput, 'documentEvidence' | 'scopeLabel'>;
  settings: AppSettings;
  context: SuggestionContext;
  isCurrent: () => boolean;
  plan?: FullDocumentDiagnosticPlan;
}

export async function requestFullDocumentDiagnosis(input: DiagnosticRunInput): Promise<string> {
  if (!isDiagnosticTask(input.task)) throw new Error('全文分块诊断只适用于逻辑、矛盾和人物一致性任务。');
  const plan = input.plan ?? buildFullDocumentDiagnosticPlan(input.fullText, input.evidenceBudget);
  const batches = plan.batches;
  const findings: string[] = [];

  for (const batch of batches) {
    if (!input.isCurrent()) throw new Error('诊断期间文档已经变化。为避免把不同版本的证据混在一起，请重新运行。');
    const response = await requestSuggestions(input.task, {
      ...input.baseContext,
      documentEvidence: batch.text,
      scopeLabel: batch.scopeLabel
    }, input.settings, input.context);
    if (!input.isCurrent()) throw new Error('诊断期间文档已经变化。为避免把不同版本的证据混在一起，请重新运行。');
    findings.push(batches.length === 1 ? response.summary : `【分块 ${batch.index}/${batch.total}】\\n${response.summary}`);
  }

  if (batches.length === 1) return findings[0] ?? '未返回诊断结果。';
  return `全文诊断已覆盖 ${batches.length} 个有重叠的上下文分块；以下结论分别对应其证据范围，不把未检查区域当作“没有问题”。\\n\\n${findings.join('\\n\\n')}`;
}
""", encoding="utf-8")

Path("src/services/diagnostics.test.ts").write_text("""import { describe, expect, it } from 'vitest';
import { buildFullDocumentDiagnosticPlan } from './diagnostics';

describe('full-document diagnostic disclosure', () => {
  it('uses the exact evidence plan disclosed to the user', () => {
    const source = Array.from({ length: 500 }, (_, index) => `段落-${index}-${'x'.repeat(24)}`).join('\\n');
    const plan = buildFullDocumentDiagnosticPlan(source, 1600);
    expect(plan.batches.length).toBeGreaterThan(1);
    expect(plan.disclosure.requestCount).toBe(plan.batches.length);
    expect(plan.disclosure.characterCount).toBe(source.trim().length);
    expect(plan.disclosure.message).toContain(`${plan.batches.length} 个有重叠的请求批次`);
    expect(plan.disclosure.message).toContain('当前文档全文');
    expect(plan.disclosure.message).toContain('DeepSeek API');
    expect(plan.disclosure.message).toContain('只有点击“确定”');
  });
});
""", encoding="utf-8")

# 2. App: explicit confirmation and race-free pending-open drain.
replace_once(
    "src/App.tsx",
    "import { requestFullDocumentDiagnosis } from './services/diagnostics';",
    "import { buildFullDocumentDiagnosticPlan, requestFullDocumentDiagnosis } from './services/diagnostics';",
)
replace_once(
    "src/App.tsx",
    "  startupDocumentPath,\n  writeRecovery,",
    "  startupDocumentPath,\n  takePendingOpenDocuments,\n  writeRecovery,",
)
replace_once(
    "src/App.tsx",
    "  const startupOpenAttemptedRef = useRef(false);\n  const sessionGenerationRef = useRef(new SessionGeneration());",
    "  const startupOpenAttemptedRef = useRef(false);\n  const pendingOpenDrainRequestedRef = useRef(false);\n  const pendingOpenDrainActiveRef = useRef(false);\n  const sessionGenerationRef = useRef(new SessionGeneration());",
)
old_open_effect = """  useEffect(() => {
    if (!editor || !isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<string>('deepwrite://open-document', (event) => {
      void (async () => {
        const decision = await prepareDocumentTransition();
        if (decision === 'cancel') return;
        const previousDocumentId = documentRef.current.id;
        const previousPath = pathRef.current;
        await applyLoaded(await openDocumentAtPath(event.payload));
        await commitDiscard(decision, previousDocumentId, previousPath);
      })().catch((caught) => setError(`无法打开来自第二实例的文档：${String(caught)}`));
    }).then((dispose) => { unlisten = dispose; });
    return () => { unlisten?.(); };
  }, [applyLoaded, commitDiscard, editor, prepareDocumentTransition]);
"""
new_open_effect = """  useEffect(() => {
    if (!editor || !isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const drainPendingOpenDocuments = async () => {
      pendingOpenDrainRequestedRef.current = true;
      if (pendingOpenDrainActiveRef.current || disposed) return;
      pendingOpenDrainActiveRef.current = true;
      try {
        while (pendingOpenDrainRequestedRef.current && !disposed) {
          pendingOpenDrainRequestedRef.current = false;
          const pendingPaths = await takePendingOpenDocuments();
          for (const pendingPath of pendingPaths) {
            if (disposed) return;
            const decision = await prepareDocumentTransition();
            if (decision === 'cancel') return;
            const previousDocumentId = documentRef.current.id;
            const previousPath = pathRef.current;
            await applyLoaded(await openDocumentAtPath(pendingPath));
            await commitDiscard(decision, previousDocumentId, previousPath);
          }
        }
      } catch (caught) {
        setError(`无法打开来自第二实例的文档：${String(caught)}`);
      } finally {
        pendingOpenDrainActiveRef.current = false;
        if (pendingOpenDrainRequestedRef.current && !disposed) void drainPendingOpenDocuments();
      }
    };

    void listen<void>('deepwrite://pending-open-documents', () => {
      void drainPendingOpenDocuments();
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
      void drainPendingOpenDocuments();
    }).catch((caught) => setError(`无法建立第二实例文件交接监听：${String(caught)}`));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [applyLoaded, commitDiscard, editor, prepareDocumentTransition]);
"""
replace_once("src/App.tsx", old_open_effect, new_open_effect)
replace_once(
    "src/App.tsx",
    "    const fullText = editor.getText({ blockSeparator: '\\n' });\n    const evidenceBudget = Math.max(1200, max - selected.length - (flankLimit * 2));\n    setAIState('running'); setAICollapsed(false);",
    "    const fullText = editor.getText({ blockSeparator: '\\n' });\n    const evidenceBudget = Math.max(1200, max - selected.length - (flankLimit * 2));\n    const diagnosticPlan = isDiagnosticTask(task) ? buildFullDocumentDiagnosticPlan(fullText, evidenceBudget) : null;\n    if (diagnosticPlan && !window.confirm(diagnosticPlan.disclosure.message)) return;\n    setAIState('running'); setAICollapsed(false);",
)
replace_once(
    "src/App.tsx",
    "      if (isDiagnosticTask(task)) {\n        const summary = await requestFullDocumentDiagnosis({\n          task, fullText, evidenceBudget,",
    "      if (isDiagnosticTask(task)) {\n        if (!diagnosticPlan) throw new Error('无法建立全文诊断计划。');\n        const summary = await requestFullDocumentDiagnosis({\n          task, fullText, evidenceBudget, plan: diagnosticPlan,",
)

# 3. Frontend command wrapper for the Rust queue.
replace_once(
    "src/services/documentFiles.ts",
    "export async function startupDocumentPath(): Promise<string | null> {\n  return invokeCommand<string | null>('startup_document_path');\n}\n",
    "export async function startupDocumentPath(): Promise<string | null> {\n  return invokeCommand<string | null>('startup_document_path');\n}\n\nexport async function takePendingOpenDocuments(): Promise<string[]> {\n  return invokeCommand<string[]>('take_pending_open_documents');\n}\n",
)

# 4. Rust pending-open FIFO: event is only a wake-up signal, queue is the authority.
replace_once(
    "src-tauri/src/commands.rs",
    "use serde_json::Value;\nuse std::fs::{self, File};",
    "use serde_json::Value;\nuse std::collections::VecDeque;\nuse std::fs::{self, File};",
)
replace_once(
    "src-tauri/src/commands.rs",
    "use std::path::{Path, PathBuf};\nuse std::time::{Duration, SystemTime};",
    "use std::path::{Path, PathBuf};\nuse std::sync::Mutex;\nuse std::time::{Duration, SystemTime};",
)
replace_once(
    "src-tauri/src/commands.rs",
    "const KEYRING_USER: &str = \"stronghold-master-password\";\n",
    """const KEYRING_USER: &str = \"stronghold-master-password\";

#[derive(Default)]
pub struct PendingOpenDocuments {
    queue: Mutex<VecDeque<String>>,
}

impl PendingOpenDocuments {
    pub(crate) fn push(&self, path: String) -> Result<(), String> {
        self.queue
            .lock()
            .map_err(|_| \"待打开文档队列不可用\".to_string())?
            .push_back(path);
        Ok(())
    }

    fn drain(&self) -> Result<Vec<String>, String> {
        let mut queue = self
            .queue
            .lock()
            .map_err(|_| \"待打开文档队列不可用\".to_string())?;
        Ok(queue.drain(..).collect())
    }
}
""",
)
replace_once(
    "src-tauri/src/commands.rs",
    "#[tauri::command]\npub fn startup_document_path() -> Option<String> {\n    dwrite_path_from_arguments(std::env::args_os().skip(1))\n}\n",
    """#[tauri::command]
pub fn startup_document_path() -> Option<String> {
    dwrite_path_from_arguments(std::env::args_os().skip(1))
}

#[tauri::command]
pub fn take_pending_open_documents(
    pending: tauri::State<'_, PendingOpenDocuments>,
) -> Result<Vec<String>, String> {
    pending.drain()
}
""",
)
commands = Path("src-tauri/src/commands.rs")
commands_text = commands.read_text(encoding="utf-8")
needle = """    #[test]
    fn startup_document_argument_accepts_only_dwrite_paths() {
        let args = vec![
            std::ffi::OsString::from("notes.txt"),
            std::ffi::OsString::from(r"C:\\Drafts\\novel.dwrite"),
        ];
        assert_eq!(
            dwrite_path_from_arguments(args).as_deref(),
            Some(r"C:\\Drafts\\novel.dwrite")
        );
        assert!(dwrite_path_from_arguments(vec![std::ffi::OsString::from("notes.md")]).is_none());
    }
"""
if commands_text.count(needle) != 1:
    raise SystemExit("commands.rs: startup argument test guard did not match exactly")
commands_text = commands_text.replace(needle, needle + """
    #[test]
    fn pending_open_queue_preserves_order_and_drains_atomically() {
        let pending = PendingOpenDocuments::default();
        pending.push(r"C:\\Drafts\\one.dwrite".into()).unwrap();
        pending.push(r"C:\\Drafts\\two.dwrite".into()).unwrap();
        assert_eq!(
            pending.drain().unwrap(),
            vec![
                r"C:\\Drafts\\one.dwrite".to_string(),
                r"C:\\Drafts\\two.dwrite".to_string()
            ]
        );
        assert!(pending.drain().unwrap().is_empty());
    }
""", 1)
commands.write_text(commands_text, encoding="utf-8")

replace_once(
    "src-tauri/src/lib.rs",
    "pub fn run() {\n    let mut builder = tauri::Builder::default();",
    "pub fn run() {\n    let mut builder = tauri::Builder::default().manage(commands::PendingOpenDocuments::default());",
)
replace_once(
    "src-tauri/src/lib.rs",
    """        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(path) = commands::dwrite_path_from_arguments(args.into_iter().skip(1)) {
                let _ = app.emit("deepwrite://open-document", path);
            }
            if let Some(window) = app.get_webview_window("main") {
""",
    """        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(path) = commands::dwrite_path_from_arguments(args.into_iter().skip(1)) {
                if app.state::<commands::PendingOpenDocuments>().push(path).is_ok() {
                    let _ = app.emit("deepwrite://pending-open-documents", ());
                }
            }
            if let Some(window) = app.get_webview_window("main") {
""",
)
replace_once(
    "src-tauri/src/lib.rs",
    "            commands::startup_document_path,\n            commands::write_recovery,",
    "            commands::startup_document_path,\n            commands::take_pending_open_documents,\n            commands::write_recovery,",
)

# 5. Documentation: make privacy and startup handoff contracts explicit.
replace_once(
    "README.md",
    "* Windows shortcuts: `Ctrl+N/O/S/Shift+S/Z/Y/F/H/B/I/U`, plus standard cut, copy, paste, and select-all shortcuts.\n",
    "* Windows shortcuts: `Ctrl+N/O/S/Shift+S/Z/Y/F/H/B/I/U`, plus standard cut, copy, paste, and select-all shortcuts.\n* Windows single-instance handoff keeps second-launch `.dwrite` paths in a Rust FIFO until the renderer listener is ready, so an early second launch cannot be lost merely because the UI has not mounted yet.\n",
)
replace_once(
    "README.md",
    "Tests cover document serialization, rejection of corrupted/future schemas, AI response schemas, exact stale-suggestion handling, ambiguous-anchor rejection, ProseMirror text-offset mapping, document-transition guard states, pause-analysis deduplication, autosave debouncing, recovery filename isolation, and basic DOCX export. GitHub Actions runs the JavaScript/TypeScript checks and Windows Rust checks on pushes and pull requests.",
    "Tests cover document serialization, rejection of corrupted/future schemas, AI response schemas, exact stale-suggestion handling, ambiguous-anchor rejection, ProseMirror text-offset mapping, document-transition guard states, pause-analysis deduplication, autosave debouncing, recovery filename isolation, full-document diagnostic disclosure/batch identity, pending second-instance FIFO ordering, and basic DOCX export. GitHub Actions runs the JavaScript/TypeScript checks and Windows Rust checks on pushes and pull requests.",
)
replace_once(
    "README.md",
    """## Privacy

Articles are stored locally by default. Relevant selections, limited surrounding context, chapter summaries, and author rules are sent to the user-configured DeepSeek API only when the user actively invokes an AI feature or explicitly enables automatic analysis after writing pauses.

DeepWrite does not, by default, retain request logs containing the full document text and stores no document text in AI suggestion-history payloads. Local version history is different: when enabled, it deliberately retains full historical document snapshots on the user's machine so that older versions can be restored. The retention limit and deletion control are exposed to the user. DeepWrite includes no telemetry and sends no data to the project maintainer.
""",
    """## Privacy

Articles are stored locally by default. Ordinary proofreading, polishing, rewriting, continuation, custom AI actions, and optional pause-analysis send only the relevant selection/recent text plus bounded surrounding context, chapter-title summary data, and author rules to the user-configured DeepSeek API when the feature is invoked. Automatic pause-analysis remains bounded to recent context and does not silently start a full-document diagnosis.

The logic-review, contradiction-detection, and character-consistency commands are different: they are full-document diagnostic operations. Before any request is sent, DeepWrite displays a separate confirmation explaining that the entire current document will be split into a specific number of overlapping request batches and sent to the configured DeepSeek API. The exact batch plan shown in that confirmation is the plan used for the diagnostic run. Cancelling the confirmation sends nothing for that run. Each batch can also include author rules, chapter-title summary data, and limited selection/cursor-adjacent context. DeepSeek's handling of received data is governed by the user's API account and DeepSeek's service terms.

DeepWrite itself does not retain AI request bodies as request logs, stores no document text in AI suggestion-history payloads, includes no telemetry, and sends no document data to the project maintainer. Local version history is different: when enabled, it deliberately retains full historical document snapshots on the user's machine so that older versions can be restored. The retention limit and deletion control are exposed to the user.
""",
)

print("final contract fixes applied")
