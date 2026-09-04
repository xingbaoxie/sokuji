import { describe, expect, it } from 'vitest';
import { normalizeSummaryResult } from './recording-result-normalizer.js';
import { parseAndValidateSummary } from './recording-summary-schema.js';
import { normalizeTemplateId, renderSummaryPrompt } from './recording-summary-templates.js';

const validSummary = {
  topic: '项目例会',
  conclusions: ['本周完成接口联调'],
  discussionPoints: [{ title: '上线安排', content: '下周进行灰度发布。' }],
  actionItems: [{ task: '准备发布说明', owner: '小李', deadline: '下周一' }],
  keywords: ['联调', '灰度'],
};

describe('recording summary contract', () => {
  it('accepts only the canonical persisted structure', () => {
    expect(parseAndValidateSummary(JSON.stringify(validSummary))).toEqual(validSummary);
    expect(() => parseAndValidateSummary(JSON.stringify({ ...validSummary, unexpected: true }))).toThrow(/invalid structure/i);
  });

  it('keeps legacy template ids readable while saving the canonical id', () => {
    expect(normalizeTemplateId('meeting-report-v1')).toBe('general-meeting');
    expect(normalizeSummaryResult(validSummary)).toEqual(validSummary);
  });

  it('puts the selected report language and schema into the cloud prompt', () => {
    const prompt = renderSummaryPrompt({ templateId: 'general-meeting', reportLanguage: 'ja', segments: [{ id: 'seg-0001', startMs: 0, endMs: 1000, text: '会議を始めます' }] });
    expect(prompt.template).toMatchObject({ id: 'general-meeting', schemaVersion: 1 });
    expect(prompt.messages.at(-1).content).toContain('日本語');
    expect(prompt.messages.at(-1).content).toContain('"actionItems"');
  });
});
