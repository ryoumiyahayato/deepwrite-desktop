import { EditorContent, type Editor } from '@tiptap/react';
import { Columns3, Rows3, Table2, Trash2 } from 'lucide-react';

export function EditorCanvas({ editor, zoom }: { editor: Editor | null; zoom: number }) {
  return <main className="document-workspace">
    {editor?.isActive('table') ? <div className="table-context" role="toolbar" aria-label="表格工具">
      <span><Table2 />表格</span><button onClick={() => editor.chain().focus().addRowAfter().run()}><Rows3 />增加行</button><button onClick={() => editor.chain().focus().deleteRow().run()}>删除行</button><button onClick={() => editor.chain().focus().addColumnAfter().run()}><Columns3 />增加列</button><button onClick={() => editor.chain().focus().deleteColumn().run()}>删除列</button><button className="danger" onClick={() => editor.chain().focus().deleteTable().run()}><Trash2 />删除表格</button>
    </div> : null}
    <div className="paper-scaler" style={{ '--paper-zoom': zoom / 100 } as React.CSSProperties}><article className="paper"><EditorContent editor={editor} /></article></div>
  </main>;
}
