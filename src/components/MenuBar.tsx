import { useEffect, useRef } from 'react';
import { ChevronDown, FilePlus2, FolderOpen, History, Save, SaveAll, Settings2 } from 'lucide-react';

export interface MenuActions {
  newDocument: () => void; open: () => void; save: () => void; saveAs: () => void;
  exportDocx: () => void; exportTxt: () => void; exportMd: () => void; exportHtml: () => void;
  find: () => void; replace: () => void; settings: () => void; history: () => void;
  toggleOutline: () => void; toggleAI: () => void; print: () => void;
}

function closeMenus(root: HTMLDivElement | null, except?: HTMLDetailsElement | null) {
  root?.querySelectorAll<HTMLDetailsElement>('details.menu[open]').forEach((details) => {
    if (details !== except) details.removeAttribute('open');
  });
}

function Menu({ label, children, onToggle }: { label: string; children: React.ReactNode; onToggle: (details: HTMLDetailsElement) => void }) {
  return <details className="menu" onToggle={(event) => onToggle(event.currentTarget)}><summary>{label}<ChevronDown /></summary><div className="menu-popover">{children}</div></details>;
}

function MenuItem({ children, shortcut, onClick }: { children: React.ReactNode; shortcut?: string; onClick: () => void }) {
  return <button onClick={(event) => { onClick(); (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }}><span>{children}</span>{shortcut ? <kbd>{shortcut}</kbd> : null}</button>;
}

export function MenuBar({ actions }: { actions: MenuActions }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('.menu')) closeMenus(rootRef.current);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenus(rootRef.current);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, []);

  const handleMenuToggle = (details: HTMLDetailsElement) => {
    if (details.open) closeMenus(rootRef.current, details);
  };

  return <div className="menu-bar" ref={rootRef}>
    <div className="app-mark">D</div>
    <Menu label="文件" onToggle={handleMenuToggle}><MenuItem onClick={actions.newDocument} shortcut="Ctrl+N"><FilePlus2 />新建</MenuItem><MenuItem onClick={actions.open} shortcut="Ctrl+O"><FolderOpen />打开</MenuItem><MenuItem onClick={actions.save} shortcut="Ctrl+S"><Save />保存</MenuItem><MenuItem onClick={actions.saveAs} shortcut="Ctrl+Shift+S"><SaveAll />另存为</MenuItem><hr /><MenuItem onClick={actions.exportDocx}>导出 DOCX</MenuItem><MenuItem onClick={actions.exportTxt}>导出 TXT</MenuItem><MenuItem onClick={actions.exportMd}>导出 Markdown</MenuItem><MenuItem onClick={actions.exportHtml}>导出 HTML</MenuItem><MenuItem onClick={actions.print}>打印 / PDF</MenuItem></Menu>
    <Menu label="编辑" onToggle={handleMenuToggle}><MenuItem onClick={() => document.execCommand('cut')} shortcut="Ctrl+X">剪切</MenuItem><MenuItem onClick={() => document.execCommand('copy')} shortcut="Ctrl+C">复制</MenuItem><MenuItem onClick={() => document.execCommand('paste')} shortcut="Ctrl+V">粘贴</MenuItem><MenuItem onClick={() => document.execCommand('selectAll')} shortcut="Ctrl+A">全选</MenuItem><hr /><MenuItem onClick={actions.find} shortcut="Ctrl+F">查找</MenuItem><MenuItem onClick={actions.replace} shortcut="Ctrl+H">替换</MenuItem></Menu>
    <Menu label="视图" onToggle={handleMenuToggle}><MenuItem onClick={actions.toggleOutline}>章节大纲</MenuItem><MenuItem onClick={actions.toggleAI}>AI 建议面板</MenuItem><MenuItem onClick={actions.history}><History />版本历史</MenuItem></Menu>
    <Menu label="插入" onToggle={handleMenuToggle}><MenuItem onClick={() => {}}>表格、图片与分页符位于工具栏</MenuItem></Menu>
    <Menu label="格式" onToggle={handleMenuToggle}><MenuItem onClick={() => {}}>字体、段落与列表位于工具栏</MenuItem></Menu>
    <Menu label="AI" onToggle={handleMenuToggle}><MenuItem onClick={actions.toggleAI}>打开 AI 建议</MenuItem><MenuItem onClick={actions.settings}><Settings2 />DeepSeek 设置</MenuItem></Menu>
    <Menu label="帮助" onToggle={handleMenuToggle}><MenuItem onClick={() => window.open('https://github.com/ryoumiyahayato/deepwrite-desktop', '_blank')}>项目主页</MenuItem></Menu>
    <span className="menu-spacer" />
    <button className="menu-settings" onClick={actions.settings}><Settings2 />设置</button>
  </div>;
}
