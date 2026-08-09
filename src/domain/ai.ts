import { z } from 'zod';

export const aiSuggestionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['grammar', 'clarity', 'style', 'logic', 'rewrite', 'other']),
  severity: z.enum(['minor', 'medium', 'major']),
  original: z.string(),
  replacement: z.string(),
  reason: z.string().min(1)
}).strict();

export const aiResponseSchema = z.object({
  summary: z.string(),
  suggestions: z.array(aiSuggestionSchema),
  fullRewrite: z.string().nullable()
}).strict();

export type AIResponse = z.infer<typeof aiResponseSchema>;
export type AISuggestionType = z.infer<typeof aiSuggestionSchema>['type'];
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'stale';

export interface SuggestionContext {
  documentId: string;
  documentRevision: number;
  selectionFrom: number;
  selectionTo: number;
  originalText: string;
  originalHash: string;
  blockIdentity: string;
}

export interface AISuggestion extends z.infer<typeof aiSuggestionSchema> {
  status: SuggestionStatus;
  context: SuggestionContext;
  targetFrom: number | null;
  targetTo: number | null;
}

export function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createSuggestionContext(
  documentId: string,
  documentRevision: number,
  selectionFrom: number,
  selectionTo: number,
  originalText: string
): SuggestionContext {
  return {
    documentId,
    documentRevision,
    selectionFrom,
    selectionTo,
    originalText,
    originalHash: stableHash(originalText),
    blockIdentity: `${documentId}:${selectionFrom}-${selectionTo}`
  };
}

export function isSuggestionStale(suggestion: AISuggestion, currentTargetText: string, currentDocumentId: string): boolean {
  if (suggestion.context.documentId !== currentDocumentId) return true;
  return stableHash(currentTargetText) !== stableHash(suggestion.original);
}

export function attachSuggestionContext(response: AIResponse, context: SuggestionContext): AISuggestion[] {
  return response.suggestions.map((suggestion) => {
    const offset = context.originalText.indexOf(suggestion.original);
    return {
      ...suggestion,
      status: 'pending',
      context,
      targetFrom: offset >= 0 ? context.selectionFrom + offset : null,
      targetTo: offset >= 0 ? context.selectionFrom + offset + suggestion.original.length : null
    };
  });
}
