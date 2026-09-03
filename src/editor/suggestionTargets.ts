import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { AISuggestion } from '../domain/ai';

export function positionAtTextOffset(
  document: ProseMirrorNode,
  from: number,
  to: number,
  offset: number
): number | null {
  const selected = document.textBetween(from, to, '\n');
  if (offset < 0 || offset > selected.length) return null;
  if (offset === 0) {
    for (let position = from; position <= to; position += 1) {
      if (document.resolve(position).parent.inlineContent) return position;
    }
    return null;
  }

  let low = from;
  let high = to;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const length = document.textBetween(from, middle, '\n').length;
    if (length < offset) low = middle + 1;
    else high = middle;
  }

  return document.textBetween(from, low, '\n').length === offset ? low : null;
}

export function resolveSuggestionTargets(
  suggestions: AISuggestion[],
  document: ProseMirrorNode,
  currentDocumentId: string,
  currentDocumentRevision: number
): AISuggestion[] {
  return suggestions.map((suggestion) => {
    if (
      suggestion.context.documentId !== currentDocumentId ||
      suggestion.context.documentRevision !== currentDocumentRevision ||
      suggestion.relativeFrom === null ||
      suggestion.relativeTo === null
    ) {
      return { ...suggestion, status: 'stale', targetFrom: null, targetTo: null };
    }

    const targetFrom = positionAtTextOffset(
      document,
      suggestion.context.selectionFrom,
      suggestion.context.selectionTo,
      suggestion.relativeFrom
    );
    const targetTo = positionAtTextOffset(
      document,
      suggestion.context.selectionFrom,
      suggestion.context.selectionTo,
      suggestion.relativeTo
    );

    if (targetFrom === null || targetTo === null || targetFrom >= targetTo) {
      return { ...suggestion, status: 'stale', targetFrom: null, targetTo: null };
    }

    const current = document.textBetween(targetFrom, targetTo, '\n');
    if (current !== suggestion.original) {
      return { ...suggestion, status: 'stale', targetFrom: null, targetTo: null };
    }

    return { ...suggestion, targetFrom, targetTo };
  });
}
