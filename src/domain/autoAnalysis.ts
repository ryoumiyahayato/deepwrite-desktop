import { stableHash } from './ai';

export function shouldAutoAnalyze(enabledMinutes: number, changed: boolean, content: string, lastHash: string | null): boolean {
  if (enabledMinutes <= 0 || !changed || !content.trim()) return false;
  return stableHash(content) !== lastHash;
}

export function recentContext(text: string, maximumCharacters: number): string {
  const paragraphs = text.split(/\n+/).filter(Boolean);
  const selected: string[] = [];
  let size = 0;
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const paragraph = paragraphs[index];
    if (size + paragraph.length > maximumCharacters && selected.length) break;
    selected.unshift(paragraph);
    size += paragraph.length + 1;
  }
  return selected.join('\n');
}
