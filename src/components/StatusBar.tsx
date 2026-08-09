import { Circle, CloudOff, Sparkles } from 'lucide-react';
import type { DocumentStats } from '../domain/document';

export function StatusBar({ stats, saveState, aiState, zoom, onZoom }: {
  stats: DocumentStats; saveState: 'saved' | 'unsaved' | 'saving' | 'error'; aiState: 'idle' | 'running' | 'error'; zoom: number; onZoom: (value: number) => void;
}) {
  const saveLabels = { saved: '已保存', unsaved: '未保存', saving: '正在保存…', error: '保存失败' };
  const aiLabels = { idle: 'AI 就绪', running: 'AI 分析中', error: 'AI 错误' };
  return <footer className="status-bar">
    <span>字数：{stats.words.toLocaleString()}</span><span>字符：{stats.characters.toLocaleString()}</span><span>段落：{stats.paragraphs.toLocaleString()}</span>
    <span className={`save-status ${saveState}`}>{saveState === 'error' ? <CloudOff /> : <Circle />}{saveLabels[saveState]}</span>
    <span className={`ai-status ${aiState}`}><Sparkles />{aiLabels[aiState]}</span>
    <span className="status-spacer" /><label className="zoom-control"><button onClick={() => onZoom(Math.max(70, zoom - 10))}>−</button><input type="range" min="70" max="140" step="10" value={zoom} onChange={(event) => onZoom(Number(event.target.value))} aria-label="页面缩放" /><button onClick={() => onZoom(Math.min(140, zoom + 10))}>＋</button><output>{zoom}%</output></label>
  </footer>;
}
