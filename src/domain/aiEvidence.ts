export interface DocumentEvidence {
  text: string;
  scopeLabel: string;
  complete: boolean;
}

export function buildDocumentEvidence(fullText: string, maxChars: number): DocumentEvidence {
  const text = fullText.trim();
  const budget = Math.max(1200, Math.floor(maxChars));
  if (text.length <= budget) {
    return { text, scopeLabel: '分析范围：当前文档全文。', complete: true };
  }

  const segments = 5;
  const separator = '\n…[文档抽样分隔]…\n';
  const usable = Math.max(segments * 80, budget - separator.length * (segments - 1));
  const chunkSize = Math.max(80, Math.floor(usable / segments));
  const maxStart = Math.max(0, text.length - chunkSize);
  const parts = Array.from({ length: segments }, (_, index) => {
    const ratio = segments === 1 ? 0 : index / (segments - 1);
    const start = Math.min(maxStart, Math.floor(maxStart * ratio));
    return text.slice(start, start + chunkSize);
  });
  return {
    text: parts.join(separator).slice(0, budget),
    scopeLabel: '分析范围：文档超过上下文预算，已按全文位置均匀抽样；未覆盖部分不能据此判定不存在矛盾或人物偏差。',
    complete: false
  };
}
