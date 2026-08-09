import { ChevronDown, ChevronRight, FileText, History, Search, Settings2 } from 'lucide-react';
import type { OutlineItem } from '../domain/document';

export function OutlinePanel({ items, collapsed, onToggle, onNavigate, recentFiles, onOpenRecent, onHistory, onSettings }: {
  items: OutlineItem[]; collapsed: boolean; onToggle: () => void; onNavigate: (position: number) => void;
  recentFiles: Array<{ path: string; title: string }>; onOpenRecent: (path: string) => void; onHistory: () => void; onSettings: () => void;
}) {
  if (collapsed) return <aside className="outline-panel collapsed"><button className="rail-toggle" onClick={onToggle} title="展开章节大纲"><ChevronRight /></button></aside>;
  return <aside className="outline-panel">
    <div className="panel-heading"><strong>章节大纲</strong><button onClick={onToggle} title="折叠章节大纲"><ChevronDown /></button></div>
    <label className="outline-search"><Search /><input placeholder="筛选章节" aria-label="筛选章节" /></label>
    <nav className="outline-tree" aria-label="文档大纲">
      {items.length ? items.map((item) => <button key={item.id} style={{ paddingLeft: `${12 + (item.level - 1) * 18}px` }} onClick={() => onNavigate(item.position)}><FileText /> <span>{item.text}</span></button>) : <p className="empty-hint">使用“标题 1–3”创建章节导航。</p>}
    </nav>
    <div className="recent-block"><div className="section-label">最近打开</div>{recentFiles.slice(0, 5).map((file) => <button key={file.path} title={file.path} onClick={() => onOpenRecent(file.path)}>{file.title}</button>)}</div>
    <div className="outline-footer"><button onClick={onHistory}><History />版本历史</button><button onClick={onSettings}><Settings2 />设置</button></div>
  </aside>;
}
