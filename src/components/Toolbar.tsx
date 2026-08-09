import type { Editor } from '@tiptap/core';
import type { AppSettings } from '../domain/settings';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ChevronDown, Highlighter,
  ImagePlus, IndentDecrease, IndentIncrease, Italic, Link2, List, ListOrdered,
  Minus, Palette, Pilcrow, Redo2, SeparatorHorizontal, Strikethrough, Table2,
  Underline as UnderlineIcon, Undo2
} from 'lucide-react';

interface ToolbarProps {
  editor: Editor | null;
  onInsertImage: () => void;
  defaults: AppSettings['editor'];
}

const fonts = ['思源宋体', '微软雅黑', '宋体', '黑体', '楷体', 'Arial', 'Georgia'];
const sizes = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36];

function ToolButton({ label, active = false, disabled = false, onClick, children }: {
  label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return <button type="button" className={`tool-button ${active ? 'active' : ''}`} title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</button>;
}

export function Toolbar({ editor, onInsertImage, defaults }: ToolbarProps) {
  const run = (callback: (editor: Editor) => void) => () => editor && callback(editor);
  const setLink = run((current) => {
    const previous = current.getAttributes('link').href as string | undefined;
    const href = window.prompt('链接地址', previous ?? 'https://');
    if (href === null) return;
    if (!href.trim()) current.chain().focus().extendMarkRange('link').unsetLink().run();
    else current.chain().focus().extendMarkRange('link').setLink({ href }).run();
  });
  const insertTable = run((current) => current.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run());
  const resizeImage = run((current) => {
    if (!current.isActive('image')) return;
    const currentWidth = String(current.getAttributes('image').width ?? 480);
    const width = Number(window.prompt('图片宽度（像素）', currentWidth));
    if (Number.isFinite(width) && width >= 80 && width <= 1200) current.chain().focus().updateAttributes('image', { width }).run();
  });
  return <div className="toolbar" role="toolbar" aria-label="格式工具栏">
    <div className="tool-group">
      <ToolButton label="撤销 (Ctrl+Z)" disabled={!editor?.can().undo()} onClick={run((e) => e.chain().focus().undo().run())}><Undo2 /></ToolButton>
      <ToolButton label="重做 (Ctrl+Y)" disabled={!editor?.can().redo()} onClick={run((e) => e.chain().focus().redo().run())}><Redo2 /></ToolButton>
    </div>
    <div className="tool-group formatting-selects">
      <select aria-label="段落样式" value={editor?.isActive('heading', { level: 1 }) ? 'h1' : editor?.isActive('heading', { level: 2 }) ? 'h2' : editor?.isActive('heading', { level: 3 }) ? 'h3' : 'p'} onChange={(event) => {
        if (!editor) return;
        if (event.target.value === 'p') editor.chain().focus().setParagraph().run();
        else editor.chain().focus().toggleHeading({ level: Number(event.target.value.slice(1)) as 1 | 2 | 3 }).run();
      }}><option value="p">正文</option><option value="h1">标题 1</option><option value="h2">标题 2</option><option value="h3">标题 3</option></select>
      <select aria-label="字体" defaultValue={defaults.defaultFont} onChange={(event) => editor?.chain().focus().setFontFamily(event.target.value).run()}>{[...new Set([defaults.defaultFont, ...fonts])].map((font) => <option key={font}>{font}</option>)}</select>
      <select aria-label="字号" defaultValue={String(defaults.defaultFontSize)} onChange={(event) => editor?.chain().focus().setFontSize(`${event.target.value}px`).run()}>{[...new Set([defaults.defaultFontSize, ...sizes])].sort((a, b) => a - b).map((size) => <option key={size} value={size}>{size}</option>)}</select>
    </div>
    <div className="tool-group">
      <ToolButton label="粗体 (Ctrl+B)" active={Boolean(editor?.isActive('bold'))} onClick={run((e) => e.chain().focus().toggleBold().run())}><Bold /></ToolButton>
      <ToolButton label="斜体 (Ctrl+I)" active={Boolean(editor?.isActive('italic'))} onClick={run((e) => e.chain().focus().toggleItalic().run())}><Italic /></ToolButton>
      <ToolButton label="下划线 (Ctrl+U)" active={Boolean(editor?.isActive('underline'))} onClick={run((e) => e.chain().focus().toggleUnderline().run())}><UnderlineIcon /></ToolButton>
      <ToolButton label="删除线" active={Boolean(editor?.isActive('strike'))} onClick={run((e) => e.chain().focus().toggleStrike().run())}><Strikethrough /></ToolButton>
      <label className="color-tool" title="字体颜色"><Palette /><input aria-label="字体颜色" type="color" defaultValue="#1c2529" onChange={(event) => editor?.chain().focus().setColor(event.target.value).run()} /></label>
      <label className="color-tool" title="文本高亮"><Highlighter /><input aria-label="文本高亮" type="color" defaultValue="#fff1a8" onChange={(event) => editor?.chain().focus().setHighlight({ color: event.target.value }).run()} /></label>
    </div>
    <div className="tool-group">
      <ToolButton label="左对齐" active={Boolean(editor?.isActive({ textAlign: 'left' }))} onClick={run((e) => e.chain().focus().setTextAlign('left').run())}><AlignLeft /></ToolButton>
      <ToolButton label="居中" active={Boolean(editor?.isActive({ textAlign: 'center' }))} onClick={run((e) => e.chain().focus().setTextAlign('center').run())}><AlignCenter /></ToolButton>
      <ToolButton label="右对齐" active={Boolean(editor?.isActive({ textAlign: 'right' }))} onClick={run((e) => e.chain().focus().setTextAlign('right').run())}><AlignRight /></ToolButton>
      <ToolButton label="两端对齐" active={Boolean(editor?.isActive({ textAlign: 'justify' }))} onClick={run((e) => e.chain().focus().setTextAlign('justify').run())}><AlignJustify /></ToolButton>
      <ToolButton label="减少缩进" onClick={run((e) => e.chain().focus().decreaseIndent().run())}><IndentDecrease /></ToolButton>
      <ToolButton label="增加缩进" onClick={run((e) => e.chain().focus().increaseIndent().run())}><IndentIncrease /></ToolButton>
      <label className="compact-select" title="行距"><Pilcrow /><select aria-label="行距" defaultValue={String(defaults.defaultLineHeight)} onChange={(event) => editor?.chain().focus().setLineHeight(event.target.value).run()}><option value="1">1.0</option><option value="1.25">1.25</option><option value="1.5">1.5</option><option value="1.75">1.75</option><option value="2">2.0</option></select><ChevronDown /></label>
    </div>
    <div className="tool-group">
      <ToolButton label="项目符号" active={Boolean(editor?.isActive('bulletList'))} onClick={run((e) => e.chain().focus().toggleBulletList().run())}><List /></ToolButton>
      <ToolButton label="编号列表" active={Boolean(editor?.isActive('orderedList'))} onClick={run((e) => e.chain().focus().toggleOrderedList().run())}><ListOrdered /></ToolButton>
      <ToolButton label="引用块" active={Boolean(editor?.isActive('blockquote'))} onClick={run((e) => e.chain().focus().toggleBlockquote().run())}><span className="quote-icon">“</span></ToolButton>
      <ToolButton label="水平分隔线" onClick={run((e) => e.chain().focus().setHorizontalRule().run())}><Minus /></ToolButton>
      <ToolButton label="链接" active={Boolean(editor?.isActive('link'))} onClick={setLink}><Link2 /></ToolButton>
    </div>
    <div className="tool-group insert-tools">
      <ToolButton label="插入表格" onClick={insertTable}><Table2 /></ToolButton>
      <ToolButton label="插入本地图片" onClick={onInsertImage}><ImagePlus /></ToolButton>
      <ToolButton label="缩放所选图片" disabled={!editor?.isActive('image')} onClick={resizeImage}><span className="size-label">↔</span></ToolButton>
      <ToolButton label="分页符 (Ctrl+Enter)" onClick={run((e) => e.chain().focus().insertContent({ type: 'pageBreak' }).run())}><SeparatorHorizontal /></ToolButton>
    </div>
  </div>;
}
