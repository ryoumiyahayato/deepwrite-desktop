import { Extension, Node, mergeAttributes } from '@tiptap/core';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TextAlign from '@tiptap/extension-text-align';
import { FontSize, LineHeight, TextStyle } from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import type { AISuggestion } from '../domain/ai';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indentation: {
      increaseIndent: () => ReturnType;
      decreaseIndent: () => ReturnType;
    };
    aiSuggestionDecorations: {
      setAiSuggestionDecorations: (suggestions: AISuggestion[]) => ReturnType;
    };
  }
}

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div[data-page-break]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'page-break' })],
  addKeyboardShortcuts: () => ({ 'Mod-Enter': ({ editor }) => editor.commands.insertContent({ type: 'pageBreak' }) })
});

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: 480, parseHTML: (element) => Number(element.getAttribute('width') ?? 480), renderHTML: (attrs) => ({ width: attrs.width }) },
      height: { default: null, parseHTML: (element) => element.getAttribute('height') ? Number(element.getAttribute('height')) : null, renderHTML: (attrs) => attrs.height ? { height: attrs.height } : {} }
    };
  }
});

export const Indentation = Extension.create({
  name: 'indentation',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading', 'blockquote'],
      attributes: {
        indent: {
          default: 0,
          parseHTML: (element) => Number(element.getAttribute('data-indent') ?? 0),
          renderHTML: (attributes) => attributes.indent ? { 'data-indent': attributes.indent, style: `margin-left: ${Number(attributes.indent) * 2}em` } : {}
        }
      }
    }];
  },
  addCommands() {
    const change = (delta: number) => ({ state, dispatch }: { state: any; dispatch?: (transaction: any) => void }) => {
      const { $from } = state.selection;
      const indent = Math.max(0, Math.min(8, Number($from.parent.attrs.indent ?? 0) + delta));
      const transaction = state.tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, indent });
      if (dispatch) dispatch(transaction);
      return true;
    };
    return { increaseIndent: () => change(1), decreaseIndent: () => change(-1) };
  }
});

const suggestionKey = new PluginKey<DecorationSet>('deepwrite-ai-suggestions');

function suggestionDecorations(document: any, suggestions: AISuggestion[]): DecorationSet {
  const decorations: Decoration[] = [];
  for (const suggestion of suggestions) {
    if (suggestion.status !== 'pending' || suggestion.targetFrom === null || suggestion.targetTo === null) continue;
    if (suggestion.targetFrom < 0 || suggestion.targetTo > document.content.size) continue;
    decorations.push(Decoration.inline(suggestion.targetFrom, suggestion.targetTo, {
      class: 'ai-suggestion-original',
      'data-suggestion-id': suggestion.id,
      'aria-label': 'AI 建议删除或替换的原文'
    }));
    decorations.push(Decoration.widget(suggestion.targetTo, () => {
      const span = window.document.createElement('span');
      span.className = 'ai-suggestion-insertion';
      span.dataset.suggestionId = suggestion.id;
      span.setAttribute('aria-label', 'AI 建议新增文本');
      span.textContent = suggestion.replacement;
      return span;
    }, { side: 1 }));
  }
  return DecorationSet.create(document, decorations);
}

export const AISuggestionDecorations = Extension.create({
  name: 'aiSuggestionDecorations',
  addCommands() {
    return {
      setAiSuggestionDecorations: (suggestions) => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(suggestionKey, suggestions));
        return true;
      }
    };
  },
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: suggestionKey,
      state: {
        init: (_, state) => DecorationSet.create(state.doc, []),
        apply: (transaction, previous) => {
          const suggestions = transaction.getMeta(suggestionKey) as AISuggestion[] | undefined;
          if (suggestions) return suggestionDecorations(transaction.doc, suggestions);
          return transaction.docChanged ? previous.map(transaction.mapping, transaction.doc) : previous;
        }
      },
      props: { decorations: (state) => suggestionKey.getState(state) }
    })];
  }
});

export const editorExtensions = [
  StarterKit.configure({ link: false, underline: false }),
  Underline,
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  LineHeight.configure({ types: ['paragraph', 'heading'] }),
  Highlight.configure({ multicolor: true }),
  Link.configure({ openOnClick: false, autolink: true, defaultProtocol: 'https' }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ResizableImage.configure({ allowBase64: true, inline: false }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  Indentation,
  PageBreak,
  AISuggestionDecorations
];
