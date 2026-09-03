import { buildDocumentEvidenceBatches, type DocumentEvidence } from '../domain/aiEvidence';
import type { SuggestionContext } from '../domain/ai';
import type { AppSettings } from '../domain/settings';
import { isDiagnosticTask, requestSuggestions, type AITask, type AIContextInput } from './deepseek';

export interface FullDocumentDiagnosticDisclosure {
  characterCount: number;
  requestCount: number;
  message: string;
}

export interface FullDocumentDiagnosticPlan {
  batches: DocumentEvidence[];
  disclosure: FullDocumentDiagnosticDisclosure;
}

export function buildFullDocumentDiagnosticPlan(fullText: string, evidenceBudget: number): FullDocumentDiagnosticPlan {
  const batches = buildDocumentEvidenceBatches(fullText, evidenceBudget);
  const characterCount = fullText.trim().length;
  const requestCount = batches.length;
  return {
    batches,
    disclosure: {
      characterCount,
      requestCount,
      message: [
        '全文诊断隐私提示',
        `此操作会把当前文档全文（约 ${characterCount} 个字符）分成 ${requestCount} 个有重叠的请求批次发送给你配置的 DeepSeek API。`,
        '每个批次还可能包含作者规则、章节标题摘要，以及当前选区或光标附近的有限上下文。',
        'DeepWrite 不会把这些请求正文写入 AI 建议历史，也不会把文档发送给项目维护者。DeepSeek 对收到数据的处理受你的 API 账户及其服务条款约束。',
        '只有点击“确定”才会开始发送全文诊断请求。'
      ].join('\n\n')
    }
  };
}

export interface DiagnosticRunInput {
  task: AITask;
  fullText: string;
  evidenceBudget: number;
  baseContext: Omit<AIContextInput, 'documentEvidence' | 'scopeLabel'>;
  settings: AppSettings;
  context: SuggestionContext;
  isCurrent: () => boolean;
  plan?: FullDocumentDiagnosticPlan;
}

export async function requestFullDocumentDiagnosis(input: DiagnosticRunInput): Promise<string> {
  if (!isDiagnosticTask(input.task)) throw new Error('全文分块诊断只适用于逻辑、矛盾和人物一致性任务。');
  const plan = input.plan ?? buildFullDocumentDiagnosticPlan(input.fullText, input.evidenceBudget);
  const batches = plan.batches;
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
