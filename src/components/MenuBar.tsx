import { useEffect, useState } from 'react';
import { ChevronDown, FilePlus2, FolderOpen, History, Save, SaveAll, Settings2 } from 'lucide-react';

export interface MenuActions {
  newDocument: () => void; open: () => void; save: () => void; saveAs: () => void;
  exportDocx: () => void; exportTxt: () => void; exportMd: () => void; exportHtml: () => void;
  find: () => void; replace: () => void; settings: () => void; history: () => void;
  toggleOutline: () => void; toggleAI: () => void; print: () => void;
}

function Menu({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return <details className="menu" open={open}>
    <summary onClick={(event) => { event.preventDefault(); onToggle(); }}>{label}<ChevronDown /></summary>
    <div className="menu-popover">{children}</div>
  </details>;
}

function MenuItem({ children, shortcut, onClick, onDismiss }: { children: React.ReactNode; shortcut?: string; onClick: () => void; onDismiss: () => void }) {
  return <button onClick={() => { onClick(); onDismiss(); }}><span>{children}</span>{shortcut ? <kbd>{shortcut}</kbd> : null}</button>;
}

export function MenuBar({ actions }: { actions: MenuActions }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const toggleMenu = (label: string) => setOpenMenu((current) => current === label ? null : label);
  const dismissMenus = () => setOpenMenu(null);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('.menu')) dismissMenus();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissMenus();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, []);

  const item = (onClick: () => void) => ({ onClick, onDismiss: dismissMenus });

  return <div className="menu-bar">
    <div className="app-mark">D</div>
    <Menu label="文件" open={openMenu === '文件'} onToggle={() => toggleMenu('文件')}><MenuItem {...item(actions.newDocument)} shortcut="Ctrl+N"><FilePlus2 />新建</MenuItem><MenuItem {...item(actions.open)} shortcut="Ctrl+O"><FolderOpen />打开</MenuItem><MenuItem {...item(actions.save)} shortcut="Ctrl+S"><Save />保存</MenuItem><MenuItem {...item(actions.saveAs)} shortcut="Ctrl+Shift+S"><SaveAll />另存为</MenuItem><hr /><MenuItem {...item(actions.exportDocx)}>导出 DOCX</MenuItem><MenuItem {...item(actions.exportTxt)}>导出 TXT</MenuItem><MenuItem {...item(actions.exportMd)}>导出 Markdown</MenuItem><MenuItem {...item(actions.exportHtml)}>导出 HTML</MenuItem><MenuItem {...item(actions.print)}>打印 / PDF</MenuItem></Menu>
    <Menu label="编辑" open={openMenu === '编辑'} onToggle={() => toggleMenu('编辑')}><MenuItem {...item(() => document.execCommand('cut'))} shortcut="Ctrl+X">剪切</MenuItem><MenuItem {...item(() => document.execCommand('copy'))} shortcut="Ctrl+C">复制</MenuItem><MenuItem {...item(() => document.execCommand('paste'))} shortcut="Ctrl+V">粘贴</MenuItem><MenuItem {...item(() => document.execCommand('selectAll'))} shortcut="Ctrl+A">全选</MenuItem><hr /><MenuItem {...item(actions.find)} shortcut="Ctrl+F">查找</MenuItem><MenuItem {...item(actions.replace)} shortcut="Ctrl+H">替换</MenuItem></Menu>
    <Menu label="视图" open={openMenu === '视图'} onToggle={() => toggleMenu('视图')}><MenuItem {...item(actions.toggleOutline)}>章节大纲</MenuItem><MenuItem {...item(actions.toggleAI)}>AI 建议面板</MenuItem><MenuItem {...item(actions.history)}><History />版本历史</MenuItem></Menu>
    <Menu label="插入" open={openMenu === '插入'} onToggle={() => toggleMenu('插入')}><MenuItem {...item(() => {})}>表格、图片与分页符位于工具栏</MenuItem></Menu>
    <Menu label="格式" open={openMenu === '格式'} onToggle={() => toggleMenu('格式')}><MenuItem {...item(() => {})}>字体、段落与列表位于工具栏</MenuItem></Menu>
    <Menu label="AI" open={openMenu === 'AI'} onToggle={() => toggleMenu('AI')}><MenuItem {...item(actions.toggleAI)}>打开 AI 建议</MenuItem><MenuItem {...item(actions.settings)}><Settings2 />DeepSeek 设置</MenuItem></Menu>
    <Menu label="帮助" open={openMenu === '帮助'} onToggle={() => toggleMenu('帮助')}><MenuItem {...item(() => window.open('https://github.com/ryoumiyahayato/deepwrite-desktop', '_blank'))}>项目主页</MenuItem></Menu>
    <span className="menu-spacer" />
    <button className="menu-settings" onClick={() => { dismissMenus(); actions.settings(); }}><Settings2 />设置</button>
  </div>;
}
