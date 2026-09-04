const { normalizeTemplateId } = require('./recording-summary-templates');
const { parseAndValidateSummary, validateSummary } = require('./recording-summary-schema');

function number(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function text(value) { return String(value ?? '').trim(); }

function normalizeTranscriptResult(value) {
  const segments = Array.isArray(value?.segments) ? value.segments : Array.isArray(value?.transcripts) ? value.transcripts : [];
  return { segments: segments.map((segment, index) => ({
    ...(segment?.id ? { id: String(segment.id) } : { id: `seg-${String(index + 1).padStart(4, '0')}` }),
    startMs: number(segment?.startMs ?? segment?.begin_time), endMs: number(segment?.endMs ?? segment?.end_time),
    ...(segment?.speakerId ? { speakerId: String(segment.speakerId) } : {}), text: text(segment?.text),
  })) };
}

function normalizeTranslationResult(value, configuredTargetLanguage = '') {
  const segments = Array.isArray(value?.segments) ? value.segments : [];
  return {
    targetLanguage: text(value?.targetLanguage) || text(configuredTargetLanguage) || 'zh',
    segments: segments.map((segment, index) => {
      return {
        ...(segment?.id ? { id: String(segment.id) } : { id: `seg-${String(index + 1).padStart(4, '0')}` }),
        startMs: number(segment?.startMs), endMs: number(segment?.endMs),
        ...(segment?.speakerId ? { speakerId: String(segment.speakerId) } : {}),
        text: text(segment?.text), translatedText: text(segment?.translatedText),
      };
    }),
  };
}

function normalizeSummaryResult(value) {
  if (typeof value === 'string') return parseAndValidateSummary(value);
  if (value && typeof value === 'object' && Array.isArray(value.conclusions) && Array.isArray(value.discussionPoints) && Array.isArray(value.actionItems) && Array.isArray(value.keywords)) return validateSummary(value);
  const legacyActions = Array.isArray(value?.actions) ? value.actions : [];
  const legacyPoints = Array.isArray(value?.topics) ? value.topics : [];
  return validateSummary({
    topic: text(value?.topic ?? value?.summary) || '录音总结',
    conclusions: (Array.isArray(value?.conclusions) ? value.conclusions : value?.decisions || []).map((item) => text(item?.text ?? item)).filter(Boolean),
    discussionPoints: legacyPoints.map((item) => ({ title: text(item?.title ?? item?.text) || '讨论要点', content: text(item?.content ?? item?.text) || '无' })),
    actionItems: legacyActions.map((item) => ({ task: text(item?.task ?? item?.text), owner: item?.owner ? text(item.owner) : null, deadline: item?.deadline ? text(item.deadline) : null })).filter((item) => item.task),
    keywords: (Array.isArray(value?.keywords) ? value.keywords : []).map(text).filter(Boolean),
  });
}

function normalizeSummaryConfig(config = {}) {
  return { ...config, templateId: normalizeTemplateId(config.templateId), templateVersion: Number(config.templateVersion) || 1, schemaVersion: Number(config.schemaVersion) || 1 };
}

module.exports = { normalizeSummaryConfig, normalizeSummaryResult, normalizeTranscriptResult, normalizeTranslationResult };
