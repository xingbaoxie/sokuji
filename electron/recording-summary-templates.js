const SUMMARY_TEMPLATE_ALIASES = Object.freeze({
  'meeting-report-v1': 'general-meeting',
});

const SUMMARY_SCHEMA_VERSION = 1;

function normalizeTemplateId(templateId) {
  const value = String(templateId || 'general-meeting').trim();
  return SUMMARY_TEMPLATE_ALIASES[value] || value || 'general-meeting';
}

function resolveReportLanguage(language) {
  return ({ zh: '简体中文', en: 'English', ja: '日本語' })[language] || '简体中文';
}

const GENERAL_MEETING = Object.freeze({
  id: 'general-meeting',
  version: 1,
  schemaVersion: SUMMARY_SCHEMA_VERSION,
  systemPrompt: `你是一名专业的会议记录与录音总结助手。只基于输入内容总结，不补充未出现的事实。忽略无意义口语和重复，但不得改变原意。输入可能包含中文、日文、英文或混合语言。只输出合法 JSON，不输出 Markdown、代码围栏或解释文字。`,
});

function resolveSummaryTemplate(templateId) {
  const normalized = normalizeTemplateId(templateId);
  if (normalized !== GENERAL_MEETING.id) throw new Error(`Unsupported recording summary template: ${normalized}`);
  return GENERAL_MEETING;
}

function renderSummaryPrompt({ templateId, reportLanguage, segments }) {
  const template = resolveSummaryTemplate(templateId);
  const content = JSON.stringify(segments.map(({ id, speakerId, startMs, endMs, text, translatedText }) => ({
    id, speakerId, startMs, endMs, text, ...(translatedText === undefined ? {} : { translatedText }),
  })));
  return {
    template,
    messages: [
      { role: 'system', content: template.systemPrompt },
      {
        role: 'user',
        content: `请根据以下录音内容生成总结报告。\n\n报告语言：${resolveReportLanguage(reportLanguage)}\n\n请严格返回以下 JSON 结构：\n{\n  "topic": "string",\n  "conclusions": ["string"],\n  "discussionPoints": [{ "title": "string", "content": "string" }],\n  "actionItems": [{ "task": "string", "owner": "string|null", "deadline": "string|null" }],\n  "keywords": ["string"]\n}\n\n所有字段必须存在；没有内容的数组必须是 []；owner 和 deadline 未明确出现时必须为 null。\n\n录音内容：\n${content}`,
      },
    ],
  };
}

function renderRepairPrompt(invalidOutput) {
  return `上一条输出不符合要求的 JSON 结构。请仅修复 JSON 格式和字段结构，保持原有总结含义，不增加新的事实。只返回合法 JSON。\n\n目标结构：\n{ "topic":"string", "conclusions":["string"], "discussionPoints":[{"title":"string","content":"string"}], "actionItems":[{"task":"string","owner":"string|null","deadline":"string|null"}], "keywords":["string"] }\n\n上一条输出：\n${invalidOutput}`;
}

module.exports = {
  SUMMARY_SCHEMA_VERSION,
  SUMMARY_TEMPLATE_ALIASES,
  normalizeTemplateId,
  renderRepairPrompt,
  renderSummaryPrompt,
  resolveReportLanguage,
  resolveSummaryTemplate,
};
