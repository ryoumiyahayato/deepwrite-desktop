import { Check, ChevronLeft, ChevronRight, Clipboard, FilePlus2, LoaderCircle, Sparkles, X } from 'lucide-react';
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
    {summary ? <div className="ai-summary"><strong>分析摘要</strong><p>{summary}</p></div> : null}
    {generatedText ? <div className="ai-summary"><strong>续写草稿</strong><p style={{ whiteSpace: 'pre-wrap' }}>{generatedText}</p><div className="suggestion-actions"><button onClick={() => navigator.clipboard.writeText(generatedText)}><Clipboard />复制</button><button onClick={onDiscardGenerated}><X />放弃</button><button className="accept" onClick={onInsertGenerated}><FilePlus2 />插入文末</button></div></div> : null}
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
      </article>) : generatedText ? null : <div className="ai-empty"><Sparkles /><p>选中文字，选择一种分析任务。AI 建议不会自动覆盖原文。</p></div>}
    </div>
  </aside>;
}
