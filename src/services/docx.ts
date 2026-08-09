import type { JSONContent } from '@tiptap/core';
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type IRunOptions
} from 'docx';

const alignment: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED
};

function dataUriBytes(uri: string): Uint8Array | null {
  const match = uri.match(/^data:[^;]+;base64,(.+)$/);
  if (!match) return null;
  const binary = atob(match[1]);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function textRun(node: JSONContent): TextRun | ExternalHyperlink {
  const options: Record<string, unknown> = { text: node.text ?? '' };
  let link: string | null = null;
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') options.bold = true;
    if (mark.type === 'italic') options.italics = true;
    if (mark.type === 'underline') options.underline = {};
    if (mark.type === 'strike') options.strike = true;
    if (mark.type === 'textStyle') {
      if (mark.attrs?.color) options.color = String(mark.attrs.color).replace('#', '');
      if (mark.attrs?.fontSize) options.size = Math.round(Number.parseFloat(String(mark.attrs.fontSize)) * 2);
      if (mark.attrs?.fontFamily) options.font = String(mark.attrs.fontFamily);
    }
    if (mark.type === 'highlight' && mark.attrs?.color) options.highlight = 'yellow';
    if (mark.type === 'link' && mark.attrs?.href) link = String(mark.attrs.href);
  }
  const run = new TextRun(options as IRunOptions);
  return link ? new ExternalHyperlink({ children: [run], link }) : run;
}

function inlineChildren(node: JSONContent): Array<TextRun | ExternalHyperlink | ImageRun> {
  const children: Array<TextRun | ExternalHyperlink | ImageRun> = [];
  for (const child of node.content ?? []) {
    if (child.type === 'text') children.push(textRun(child));
    if (child.type === 'hardBreak') children.push(new TextRun({ break: 1 }));
    if (child.type === 'image' && typeof child.attrs?.src === 'string') {
      const bytes = dataUriBytes(child.attrs.src);
      if (bytes) children.push(new ImageRun({ type: 'png', data: bytes, transformation: { width: Number(child.attrs.width ?? 480), height: Number(child.attrs.height ?? 300) } }));
    }
  }
  return children;
}

function paragraph(node: JSONContent, list?: 'bullet' | 'number'): Paragraph {
  const options: Record<string, unknown> = {
    children: inlineChildren(node),
    alignment: alignment[String(node.attrs?.textAlign ?? 'left')]
  };
  if (node.type === 'heading') {
    const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
    options.heading = levels[Math.max(0, Math.min(2, Number(node.attrs?.level ?? 1) - 1))];
  }
  if (node.type === 'blockquote') options.indent = { left: 720 };
  if (list === 'bullet') options.bullet = { level: 0 };
  if (list === 'number') options.numbering = { reference: 'deepwrite-numbering', level: 0 };
  if (node.attrs?.lineHeight) options.spacing = { line: Math.round(Number(node.attrs.lineHeight) * 240) };
  if (node.attrs?.indent) options.indent = { left: Number(node.attrs.indent) * 360 };
  return new Paragraph(options as IParagraphOptions);
}

type DocChild = Paragraph | Table;

function table(node: JSONContent): Table {
  const rows = (node.content ?? []).filter((child) => child.type === 'tableRow').map((row) =>
    new TableRow({ children: (row.content ?? []).map((cell) => new TableCell({
      width: { size: 100 / Math.max(1, row.content?.length ?? 1), type: WidthType.PERCENTAGE },
      children: (cell.content ?? []).map((child) => paragraph(child))
    })) })
  );
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

function convertNodes(nodes: JSONContent[], list?: 'bullet' | 'number'): DocChild[] {
  const result: DocChild[] = [];
  for (const node of nodes) {
    if (['paragraph', 'heading', 'blockquote'].includes(node.type ?? '')) result.push(paragraph(node, list));
    else if (node.type === 'horizontalRule') result.push(new Paragraph({ text: '────────────────────────' }));
    else if (node.type === 'pageBreak') result.push(new Paragraph({ children: [new PageBreak()] }));
    else if (node.type === 'bulletList') result.push(...convertNodes(node.content ?? [], 'bullet'));
    else if (node.type === 'orderedList') result.push(...convertNodes(node.content ?? [], 'number'));
    else if (node.type === 'listItem') result.push(...convertNodes(node.content ?? [], list));
    else if (node.type === 'table') result.push(table(node));
    else if (node.type === 'image') {
      const bytes = typeof node.attrs?.src === 'string' ? dataUriBytes(node.attrs.src) : null;
      if (bytes) result.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: bytes, transformation: { width: Number(node.attrs?.width ?? 480), height: Number(node.attrs?.height ?? 300) } })] }));
    }
  }
  return result;
}

export async function exportDocx(content: JSONContent, title: string): Promise<Uint8Array> {
  const document = new Document({
    creator: 'DeepWrite',
    title,
    description: 'Exported from DeepWrite',
    numbering: {
      config: [{
        reference: 'deepwrite-numbering',
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START }]
      }]
    },
    sections: [{ properties: {}, children: convertNodes(content.content ?? []) }]
  });
  return new Uint8Array(await Packer.toArrayBuffer(document));
}

export async function importDocx(data: Uint8Array): Promise<{ html: string; warnings: string[] }> {
  const mammoth = await import('mammoth/mammoth.browser');
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const result = await mammoth.convertToHtml({ arrayBuffer }, {
    styleMap: ['p[style-name="Heading 1"] => h1:fresh', 'p[style-name="Heading 2"] => h2:fresh', 'p[style-name="Heading 3"] => h3:fresh']
  });
  return { html: result.value, warnings: result.messages.map((message: { message: string }) => message.message) };
}
