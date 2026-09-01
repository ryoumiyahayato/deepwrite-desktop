import { buildDocumentEvidenceBatches } from '../domain/aiEvidence';
import type { SuggestionContext } from '../domain/ai';
import type { AppSettings } from '../domain/settings';
import { isDiagnosticTask, requestSuggestions, type AITask, type AIContextInput } from './deepseek';

export interface DiagnosticRunInput {
  task: AITask;
  fullText: string;
  evidenceBudget: number;
  baseContext: Omit<AIContextInput, 'documentEvidence' | 'scopeLabel'>;
  settings: AppSettings;
  context: SuggestionContext;
  isCurrent: () => boolean;
}

export async function requestFullDocumentDiagnosis(input: DiagnosticRunInput): Promise<string> {
  if (!isDiagnosticTask(input.task)) throw new Error('全文分块诊断只适用于逻辑、矛盾和人物一致性任务。');
  const batches = buildDocumentEvidenceBatches(input.fullText, input.evidenceBudget);
  const findings: string[] = [];

  for (const batch of batches) {
    if (!input.isCurrent()) throw new Error('诊断期间文档已经变化。为避免把不同版本的证据混在一起，请重新运行。');
    const response = await requestSuggestions(input.task, {
      ...input.baseContext,
      documentEvidence: batch.text,
      scopeLabel: batch.scopeLabel
    }, input.settings, input.context);
    if (!input.isCurrent()) throw new Error('诊断期间文档已经变化。为避免把不同版本的证据混在一起，请重新运行。');
    findings.push(batches.length === 1 ? response.summary : `【分块 ${batch.index}/${batch.total}】\n${response.summary}`);
  }

  if (batches.length === 1) return findings[0] ?? '未返回诊断结果。';
  return `全文诊断已覆盖 ${batches.length} 个有重叠的上下文分块；以下结论分别对应其证据范围，不把未检查区域当作“没有问题”。\n\n${findings.join('\n\n')}`;
}
