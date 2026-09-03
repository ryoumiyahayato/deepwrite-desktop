export interface DocumentEvidence {
  text: string;
  scopeLabel: string;
  complete: boolean;
  index: number;
  total: number;
  start: number;
  end: number;
}

export function buildDocumentEvidenceBatches(fullText: string, maxChars: number): DocumentEvidence[] {
  const text = fullText.trim();
  const budget = Math.max(1200, Math.floor(maxChars));
  if (!text.length) {
    return [{ text: '', scopeLabel: '分析范围：当前文档为空。', complete: true, index: 1, total: 1, start: 0, end: 0 }];
  }
  if (text.length <= budget) {
    return [{ text, scopeLabel: '分析范围：当前文档全文。', complete: true, index: 1, total: 1, start: 0, end: text.length }];
  }

  const overlap = Math.min(320, Math.max(120, Math.floor(budget * 0.08)));
  const step = Math.max(1, budget - overlap);
  const ranges: Array<{ start: number; end: number }> = [];
  for (let start = 0; start < text.length; start += step) {
    const end = Math.min(text.length, start + budget);
    ranges.push({ start, end });
    if (end === text.length) break;
  }

  const total = ranges.length;
  return ranges.map(({ start, end }, offset) => ({
    text: text.slice(start, end),
    scopeLabel: `分析范围：全文分块 ${offset + 1}/${total}，字符 ${start + 1}-${end}。所有分块完成后才可形成全局结论。`,
    complete: false,
    index: offset + 1,
    total,
    start,
    end
  }));
}

export function buildDocumentEvidence(fullText: string, maxChars: number): DocumentEvidence {
  return buildDocumentEvidenceBatches(fullText, maxChars)[0];
}
