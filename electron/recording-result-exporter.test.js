import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { summaryText, transcriptText, translationText, writeSummaryDocx } from './recording-result-exporter.js';

const summary = {
  topic: '项目例会', conclusions: ['确定下周灰度发布'],
  discussionPoints: [{ title: '风险', content: '需要完成回归测试。' }],
  actionItems: [{ task: '发布说明', owner: '小李', deadline: '周一' }], keywords: ['灰度发布'],
};

describe('recording result exporter', () => {
  it('renders portable text from structured results', () => {
    const translationPrefix = '[00:01:45.600] [S01] ';
    expect(transcriptText({ segments: [{ startMs: 105600, speakerId: 'S01', text: '你好' }] })).toBe('[00:01:45.600] [S01] 你好');
    expect(translationText({ segments: [{ startMs: 105600, speakerId: 'S01', text: 'hello', translatedText: '你好' }] })).toBe(`${translationPrefix}原文：hello\n${' '.repeat(translationPrefix.length)}译文：你好`);
    expect(summaryText(summary)).toContain('确定下周灰度发布');
  });

  it('writes a non-empty dynamic Word report without a template file', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sokuji-report-'));
    const output = path.join(directory, 'report.docx');
    try {
      await writeSummaryDocx(output, { sourceFileName: 'meeting.m4a', createdAt: '2026-09-04T00:00:00.000Z', summary });
      const file = await readFile(output);
      expect(file.subarray(0, 2).toString()).toBe('PK');
      expect(file.length).toBeGreaterThan(1000);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
