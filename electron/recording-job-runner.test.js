import { describe, expect, it, vi } from 'vitest';
import { mergeTranscriptAndTranslation, runRecordingJob } from './recording-job-runner.js';

describe('recording job runner', () => {
  it('preserves original text and adds translations for bilingual summary input', () => {
    expect(mergeTranscriptAndTranslation(
      [{ id: 'seg-1', text: 'hello' }, { id: 'seg-2', text: 'world' }],
      { segments: [{ id: 'seg-1', translatedText: '你好' }] },
    )).toEqual([{ id: 'seg-1', text: 'hello', translatedText: '你好' }, { id: 'seg-2', text: 'world' }]);
  });

  it('runs every enabled stage against a mocked Runtime client', async () => {
    const stages = [];
    const client = {
      submitSpeech: vi.fn().mockResolvedValue({ taskId: 'speech_1' }),
      submit: vi.fn().mockImplementation((stage) => Promise.resolve({ taskId: `${stage}_1` })),
      getTask: vi.fn().mockResolvedValue({ status: 'completed' }),
      getResult: vi.fn().mockImplementation((taskId) => {
        if (taskId === 'speech_1') return { segments: [{ id: 'seg-1', text: 'hello' }] };
        if (taskId === 'translation_1') return { segments: [{ id: 'seg-1', translatedText: '你好' }] };
        return { summary: 'Summary' };
      }),
      cancel: vi.fn(),
    };
    const result = await runRecordingJob({ sourcePath: '/tmp/meeting.m4a', config: { translation: { enabled: true }, summary: { enabled: true } } }, client, async (...event) => stages.push(event));
    expect(result.taskIds).toEqual({ speech: 'speech_1', translation: 'translation_1', summary: 'summary_1' });
    expect(result.translation.segments[0].translatedText).toBe('你好');
    expect(stages.filter(([stage, status]) => stage === 'report.build' && status === 'completed')).toHaveLength(1);
  });

  it('uses the stage-specific private clients after speech completes', async () => {
    const speech = { submitSpeech: vi.fn().mockResolvedValue({ taskId: 'speech' }), getTask: vi.fn().mockResolvedValue({ status: 'completed' }), getResult: vi.fn().mockResolvedValue({ segments: [] }), cancel: vi.fn() };
    const translation = { submit: vi.fn().mockResolvedValue({ taskId: 'translation' }), getTask: vi.fn().mockResolvedValue({ status: 'completed' }), getResult: vi.fn().mockResolvedValue({ segments: [] }), cancel: vi.fn() };
    const summary = { submit: vi.fn().mockResolvedValue({ taskId: 'summary' }), getTask: vi.fn().mockResolvedValue({ status: 'completed' }), getResult: vi.fn().mockResolvedValue({ summary: 'done' }), cancel: vi.fn() };
    await runRecordingJob({ sourcePath: '/tmp/meeting.m4a', config: { translation: { enabled: true, provider: 'private-runtime' }, summary: { enabled: true, provider: 'private-runtime', inputMode: 'source' } } }, speech, async () => undefined, { translationClient: translation, summaryClient: summary });
    expect(speech.submit).toBeUndefined();
    expect(translation.submit).toHaveBeenCalledWith('translation', expect.any(Object));
    expect(summary.submit).toHaveBeenCalledWith('summary', expect.any(Object));
  });

  it('cancels a remote task after polling timeout', async () => {
    const client = { getTask: vi.fn().mockResolvedValue({ status: 'running' }), getResult: vi.fn(), cancel: vi.fn() };
    const { waitForRemoteTask } = await import('./recording-job-runner.js');
    await expect(waitForRemoteTask(client, 'task_1', { pollMs: 0, timeoutMs: 1, maxPolls: 1 })).rejects.toThrow(/timed out/i);
    expect(client.cancel).toHaveBeenCalledWith('task_1');
  });

  it('resumes a persisted speech task without submitting a duplicate upload', async () => {
    const client = {
      submitSpeech: vi.fn(),
      getTask: vi.fn().mockResolvedValue({ status: 'completed' }),
      getResult: vi.fn().mockResolvedValue({ segments: [] }),
      cancel: vi.fn(),
    };
    const result = await runRecordingJob({ sourcePath: '/tmp/meeting.m4a', remoteTaskIds: { speech: 'speech_existing' }, config: { translation: { enabled: false }, summary: { enabled: false } } }, client, async () => undefined);
    expect(result.taskIds.speech).toBe('speech_existing');
    expect(client.submitSpeech).not.toHaveBeenCalled();
  });

  it('does not build a report stage when summary output is disabled', async () => {
    const stages = [];
    const client = { submitSpeech: vi.fn().mockResolvedValue({ taskId: 'speech' }), getTask: vi.fn().mockResolvedValue({ status: 'completed' }), getResult: vi.fn().mockResolvedValue({ segments: [] }), cancel: vi.fn() };
    await runRecordingJob({ sourcePath: '/tmp/meeting.m4a', config: { translation: { enabled: false }, summary: { enabled: false } } }, client, async (...event) => stages.push(event));
    expect(stages.some(([stage]) => stage === 'report.build')).toBe(false);
  });
});
