import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, KeyRound, RotateCcw, Save, ShieldCheck, Trash2, X } from 'lucide-react';
import type { DeepWriteDocument } from '../domain/document';
import type { AppSettings } from '../domain/settings';
import type { VersionRecord } from '../services/database';

export function Modal({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button onClick={onClose} aria-label="关闭"><X /></button></header>{children}</section></div>;
}

export function SettingsDialog({ initial, hasKey, onClose, onSave, onSaveKey, onDeleteKey, onTest }: {
  initial: AppSettings; hasKey: boolean; onClose: () => void; onSave: (settings: AppSettings) => Promise<void>;
  onSaveKey: (key: string) => Promise<void>; onDeleteKey: () => Promise<void>; onTest: (model: string, key?: string) => Promise<{ success: boolean; message: string }>;
}) {
  const [settings, setSettings] = useState(() => structuredClone(initial));
  const [tab, setTab] = useState<'general' | 'editor' | 'ai' | 'appearance'>('general');
  const [key, setKey] = useState('');
  const [keyStored, setKeyStored] = useState(hasKey);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const mutate = <K extends keyof AppSettings>(section: K, value: AppSettings[K]) => setSettings((current) => ({ ...current, [section]: value }));
  return <Modal title="设置" onClose={onClose} wide><div className="settings-layout">
    <nav className="settings-tabs">{([['general', '常规'], ['editor', '编辑'], ['ai', 'AI'], ['appearance', '外观']] as const).map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
    <div className="settings-content">
      {tab === 'general' ? <><SettingRow label="默认保存目录" description="新文档另存为时优先使用的目录"><input value={settings.general.defaultSaveDirectory} placeholder="留空则由系统记忆上次目录" onChange={(event) => mutate('general', { ...settings.general, defaultSaveDirectory: event.target.value })} /></SettingRow><SettingRow label="自动保存" description="停笔约 1.5 秒后安全写入当前 .dwrite 文件"><input type="checkbox" checked={settings.general.autosaveEnabled} onChange={(event) => mutate('general', { ...settings.general, autosaveEnabled: event.target.checked })} /></SettingRow><SettingRow label="最近文件数量"><input type="number" min="1" max="50" value={settings.general.recentFilesLimit} onChange={(event) => mutate('general', { ...settings.general, recentFilesLimit: Number(event.target.value) })} /></SettingRow><SettingRow label="每个文档保留的版本快照" description="版本快照包含完整正文，仅保存在本机 deepwrite.db；设为 0 可关闭新快照"><input type="number" min="0" max="500" value={settings.general.versionHistoryLimit} onChange={(event) => mutate('general', { ...settings.general, versionHistoryLimit: Number(event.target.value) })} /></SettingRow></> : null}
      {tab === 'editor' ? <><SettingRow label="默认字体"><input value={settings.editor.defaultFont} onChange={(event) => mutate('editor', { ...settings.editor, defaultFont: event.target.value })} /></SettingRow><SettingRow label="默认字号"><input type="number" min="8" max="96" value={settings.editor.defaultFontSize} onChange={(event) => mutate('editor', { ...settings.editor, defaultFontSize: Number(event.target.value) })} /></SettingRow><SettingRow label="默认行距"><select value={settings.editor.defaultLineHeight} onChange={(event) => mutate('editor', { ...settings.editor, defaultLineHeight: Number(event.target.value) })}><option value="1">1.0</option><option value="1.25">1.25</option><option value="1.5">1.5</option><option value="1.75">1.75</option><option value="2">2.0</option></select></SettingRow></> : null}
      {tab === 'ai' ? <div className="ai-settings">
        <div className="secret-box"><div><KeyRound /><span><strong>DeepSeek API Key</strong><small>{keyStored ? '已安全保存在 Stronghold 保险库' : '尚未配置'}</small></span></div><input type="password" autoComplete="off" value={key} placeholder={keyStored ? '输入新 Key 可替换现有 Key' : 'sk-…'} onChange={(event) => setKey(event.target.value)} /><div className="secret-actions"><button disabled={!key.trim() || busy} onClick={async () => { setBusy(true); try { await onSaveKey(key); setKey(''); setKeyStored(true); setResult({ success: true, message: 'Key 已安全保存' }); } finally { setBusy(false); } }}><Save />保存 / 修改 Key</button><button disabled={!keyStored || busy} onClick={async () => { setBusy(true); try { await onDeleteKey(); setKeyStored(false); setResult({ success: true, message: 'Key 已删除' }); } finally { setBusy(false); } }}>删除 Key</button><button disabled={busy || (!keyStored && !key.trim())} onClick={async () => { setBusy(true); try { setResult(await onTest(settings.ai.fastModel, key || undefined)); } finally { setBusy(false); } }}><ShieldCheck />测试连接</button></div>{result ? <p className={result.success ? 'test-success' : 'test-error'}>{result.success ? <CheckCircle2 /> : <AlertTriangle />}{result.message}</p> : null}</div>
        <SettingRow label="快速模型"><input value={settings.ai.fastModel} onChange={(event) => mutate('ai', { ...settings.ai, fastModel: event.target.value })} /><small>默认 deepseek-v4-flash</small></SettingRow>
        <SettingRow label="深度模型"><input value={settings.ai.deepModel} onChange={(event) => mutate('ai', { ...settings.ai, deepModel: event.target.value })} /><small>默认 deepseek-v4-pro</small></SettingRow>
        <SettingRow label="停笔自动分析" description="默认关闭；只分析有变化的近期段落"><select value={settings.ai.idleAnalysisMinutes} onChange={(event) => mutate('ai', { ...settings.ai, idleAnalysisMinutes: Number(event.target.value) as AppSettings['ai']['idleAnalysisMinutes'] })}><option value="0">关闭</option><option value="1">1 分钟</option><option value="3">3 分钟</option><option value="5">5 分钟</option><option value="10">10 分钟</option><option value="15">15 分钟</option></select></SettingRow>
        <SettingRow label="最大上下文字符数"><input type="number" min="1000" max="100000" step="1000" value={settings.ai.maxContextCharacters} onChange={(event) => mutate('ai', { ...settings.ai, maxContextCharacters: Number(event.target.value) })} /></SettingRow>
        <label className="author-rules"><span>作者规则</span><textarea rows={7} value={settings.ai.authorRules} onChange={(event) => mutate('ai', { ...settings.ai, authorRules: event.target.value })} /></label>
      </div> : null}
      {tab === 'appearance' ? <SettingRow label="主题"><select value={settings.appearance.theme} onChange={(event) => mutate('appearance', { theme: event.target.value as AppSettings['appearance']['theme'] })}><option value="light">浅色</option><option value="dark">深色</option><option value="system">跟随系统</option></select></SettingRow> : null}
    </div>
  </div><footer className="modal-actions"><button onClick={onClose}>取消</button><button className="primary" onClick={async () => { await onSave(settings); onClose(); }}>保存设置</button></footer></Modal>;
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return <label className="setting-row"><span><strong>{label}</strong>{description ? <small>{description}</small> : null}</span><div>{children}</div></label>;
}

export function FindReplaceDialog({ replaceMode, onClose, onFind, onReplace, onReplaceAll }: {
  replaceMode: boolean; onClose: () => void; onFind: (query: string) => void; onReplace: (query: string, replacement: string) => void; onReplaceAll: (query: string, replacement: string) => void;
}) {
  const [query, setQuery] = useState(''); const [replacement, setReplacement] = useState('');
  return <Modal title={replaceMode ? '查找和替换' : '查找'} onClose={onClose}><div className="find-dialog"><label>查找<input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onFind(query)} /></label>{replaceMode ? <label>替换为<input value={replacement} onChange={(event) => setReplacement(event.target.value)} /></label> : null}<div><button onClick={() => onFind(query)}>查找下一个</button>{replaceMode ? <><button onClick={() => onReplace(query, replacement)}>替换</button><button onClick={() => onReplaceAll(query, replacement)}>全部替换</button></> : null}</div></div></Modal>;
}

export function HistoryDialog({ versions, onClose, onRestore, onClear }: { versions: VersionRecord[]; onClose: () => void; onRestore: (version: VersionRecord) => void; onClear: () => void }) {
  return <Modal title="版本历史" onClose={onClose} wide><div className="history-list">{versions.length ? versions.map((version) => <article key={version.id}><Clock3 /><div><strong>{new Date(version.createdAt).toLocaleString()}</strong><span>{version.reason} · {version.wordCount.toLocaleString()} 字</span></div><button onClick={() => onRestore(version)}><RotateCcw />恢复</button></article>) : <p className="empty-hint">尚无版本记录。手动保存、AI 替换和重要导入会创建快照。</p>}</div><footer className="modal-actions"><span>版本快照包含完整正文，仅保存在本机 SQLite。</span><button disabled={!versions.length} onClick={onClear}><Trash2 />清除本地版本历史</button></footer></Modal>;
}

export function RecoveryDialog({ document, onRestore, onDiscard }: { document: DeepWriteDocument; onRestore: () => void; onDiscard: () => void }) {
  return <Modal title="发现异常恢复内容" onClose={onDiscard}><div className="recovery-dialog"><AlertTriangle /><div><p>DeepWrite 发现上次未正常清理的自动恢复内容。</p><dl><dt>文档</dt><dd>{document.title}</dd><dt>更新时间</dt><dd>{new Date(document.updatedAt).toLocaleString()}</dd></dl></div></div><footer className="modal-actions"><button onClick={onDiscard}>放弃恢复</button><button className="primary" onClick={onRestore}>恢复文档</button></footer></Modal>;
}

export function ErrorNotice({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => { const timer = setTimeout(onClose, 8000); return () => clearTimeout(timer); }, [onClose]);
  return <div className="error-notice" role="alert"><AlertTriangle /><span>{message}</span><button onClick={onClose}><X /></button></div>;
}
