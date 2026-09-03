import type { AppSettings } from '../domain/settings';
import {
  aiResponseSchema,
  attachSuggestionContext,
  type AIResponse,
  type AISuggestion,
  type SuggestionContext
} from '../domain/ai';
import { invokeCommand } from './platform';
import { readDeepSeekKey } from './secrets';

export type AITask = 'proofread' | 'light-polish' | 'deep-polish' | 'shorten' | 'expand' | 'rewrite' | 'logic' | 'contradiction' | 'character' | 'continue' | 'custom' | 'auto';

const diagnosticTasks = new Set<AITask>(['logic', 'contradiction', 'character']);
export function isDiagnosticTask(task: AITask): boolean { return diagnosticTasks.has(task); }

const taskInstructions: Record<AITask, string> = {
  proofread: '校对错别字、语法、标点和明显用词问题，尽量少改。',
  'light-polish': '轻度润色，保留叙事声音、节奏和句式特征。',
  'deep-polish': '深度润色表达，但不要改变事实、人物动机和叙事视角。',
  shorten: '精简冗余表达，保留信息与语气。',
  expand: '在不引入无根据事实的前提下扩写细节与感受。',
  rewrite: '提供质量更高的重写方案，并解释关键变化。',
  logic: '只在提供的证据范围内检查因果、动机、时间顺序和论证逻辑；证据不足时明确说明。',
  contradiction: '只在提供的证据范围内检查前后矛盾；不得把未覆盖内容推断为不存在矛盾。',
  character: '只在提供的证据范围内检查人物身份、语气、行为与已知设定是否一致；证据不足时明确说明。',
  continue: '根据上下文继续写作，保持叙事视角与文风。',
  custom: '严格执行用户给出的自定义要求。',
  auto: '只指出近期修改中值得注意的语法、清晰度、逻辑或一致性问题。'
};

export interface AIContextInput {
  selected: string;
  before: string;
  after: string;
  chapterSummary: string;
  authorRules: string;
  documentEvidence?: string;
  scopeLabel?: string;
  customInstruction?: string;
}

function promptFor(task: AITask, context: AIContextInput, repair = false): string {
  const repairInstruction = repair ? '\n上一次返回未通过 schema 校验。只返回一个严格有效的 JSON 对象，不要 Markdown。' : '';
  const evidence = context.documentEvidence
    ? `\n${context.scopeLabel || '分析范围：提供的文档证据。'}\n【文档证据】\n${context.documentEvidence}\n【文档证据结束】\n`
    : '';
  const common = `你是中文长篇写作编辑。任务：${taskInstructions[task]}
${context.customInstruction ? `自定义要求：${context.customInstruction}` : ''}
作者规则：
${context.authorRules || '无'}

章节/结构索引：${context.chapterSummary || '未提供'}${evidence}
前文：${context.before || '无'}
【目标原文】
${context.selected}
【目标结束】
后文：${context.after || '无'}\n`;

  if (task === 'continue') {
    return `${common}
必须返回 JSON 对象，且只有以下字段：
{"summary":"string","suggestions":[],"fullRewrite":"只包含新续写正文，不要重复目标原文"}
续写内容放在 fullRewrite；suggestions 必须为空数组。不要把续写伪装成替换建议。${repairInstruction}`;
  }

  if (isDiagnosticTask(task)) {
    return `${common}
这是诊断任务，不是改写任务。必须返回 JSON 对象，且只有以下字段：
{"summary":"用清晰的条目化文字列出发现、证据位置与不确定性；没有问题也要说明检查范围","suggestions":[],"fullRewrite":null}
不得为了满足格式而制造 replacement；suggestions 必须为空数组。${repairInstruction}`;
  }

  return `${common}
必须返回 JSON 对象，且只有以下字段：
{"summary":"string","suggestions":[{"id":"string","type":"grammar|clarity|style|logic|rewrite|other","severity":"minor|medium|major","original":"必须逐字且唯一地出现在目标原文中，并限制在单一段落内，不得包含换行","replacement":"string","reason":"string"}],"fullRewrite":null}
不要把建议直接应用到原文。不要为重复出现而无法唯一定位的原文生成可替换建议。没有问题时 suggestions 返回空数组。${repairInstruction}`;
}

function extractContent(response: unknown): string {
  const value = response as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = value.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('DeepSeek 响应缺少 message.content。');
  return content;
}

function parseValidated(content: string): AIResponse {
  let parsed: unknown;
  try { parsed = JSON.parse(content); }
  catch { throw new Error('DeepSeek 返回的内容不是有效 JSON。'); }
  const result = aiResponseSchema.safeParse(parsed);
  if (!result.success) throw new Error(`AI 响应结构无效：${result.error.issues[0]?.message ?? '未知错误'}`);
  return result.data;
}

async function rawRequest(apiKey: string, model: string, prompt: string) {
  return invokeCommand<unknown>('call_deepseek', {
    request: {
      apiKey,
      model,
      messages: [{ role: 'system', content: 'Return strict JSON only.' }, { role: 'user', content: prompt }],
      maxTokens: 4096,
      responseFormat: { type: 'json_object' }
    }
  });
}

export async function requestSuggestions(
  task: AITask,
  input: AIContextInput,
  settings: AppSettings,
  context: SuggestionContext
): Promise<{ summary: string; suggestions: AISuggestion[]; fullRewrite: string | null }> {
  const apiKey = await readDeepSeekKey();
  if (!apiKey) throw new Error('请先在“设置 → AI → DeepSeek”中保存 API Key。');
  const deepTasks: AITask[] = ['deep-polish', 'logic', 'contradiction', 'character', 'rewrite'];
  const model = deepTasks.includes(task) ? settings.ai.deepModel : settings.ai.fastModel;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await rawRequest(apiKey, model, promptFor(task, input, attempt === 1));
      const validated = parseValidated(extractContent(raw));
      if (task === 'continue' && (!validated.fullRewrite?.trim() || validated.suggestions.length > 0)) {
        throw new Error('续写响应必须只包含 fullRewrite，且 suggestions 为空。');
      }
      if (task !== 'continue' && validated.fullRewrite !== null) {
        throw new Error('非续写任务不应返回 fullRewrite。');
      }
      if (isDiagnosticTask(task) && validated.suggestions.length > 0) {
        throw new Error('诊断任务只能返回分析发现，不应生成可执行替换建议。');
      }
      return { ...validated, suggestions: attachSuggestionContext(validated, context) };
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error('AI 响应校验失败。');
}

export async function testDeepSeekConnection(model: string, enteredKey?: string) {
  const apiKey = enteredKey?.trim() || await readDeepSeekKey();
  if (!apiKey) return { success: false, message: '请先填写或保存 API Key' };
  return invokeCommand<{ success: boolean; message: string }>('test_deepseek', { apiKey, model });
}
