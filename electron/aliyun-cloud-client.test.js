import { describe, expect, it, vi } from 'vitest';
import { AliyunOssClient, BailianClient, buildSpeechParameters, normalizeTranscript, parseMarkerBatch, parseSummary, translateSegments } from './aliyun-cloud-client.js';

const profile = { workspaceId: 'workspace1', dashscopeApiKey: 'not-exposed' };

describe('Aliyun Cloud client', () => {
  it('maps language, hotwords and diarization into Filetrans parameters', () => {
    expect(buildSpeechParameters({ sourceLanguageMode: 'fixed', sourceLanguage: 'ja', hotwords: ['Sokuji'] })).toEqual({ channel_id: [0], diarization_enabled: true, language_hints: ['ja'], vocabulary: { Sokuji: 4 } });
  });

  it('converts OSS multipart progress into a UI-safe percentage', async () => {
    const multipartUpload = vi.fn().mockImplementation(async (_key, _path, options) => {
      options.progress(0.427);
      options.progress(1);
      return { res: { status: 200 } };
    });
    const progress = [];
    const oss = new AliyunOssClient(profile, { multipartUpload });
    await oss.upload('recordings/a.m4a', '/tmp/a.m4a', { onUploadProgress: (value) => progress.push(value) });
    expect(progress).toEqual([42, 99]);
  });

  it('submits an async Filetrans task using the Beijing workspace endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ request_id: 'req1', output: { task_id: 'task1' } }) });
    const client = new BailianClient(profile, { fetchImpl });
    await expect(client.submitFiletrans('https://oss.example/audio.m4a', { sourceLanguageMode: 'auto' })).resolves.toEqual({ externalTaskId: 'task1', requestId: 'req1' });
    expect(fetchImpl.mock.calls[0][0]).toContain('workspace1.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/asr/transcription');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).parameters).toMatchObject({ diarization_enabled: true });
  });

  it('uses an explicitly configured endpoint and speech model', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ request_id: 'req1', output: { task_id: 'task1' } }) });
    const client = new BailianClient({ ...profile, apiBaseUrl: 'https://bailian-proxy.example', modelId: 'profile-model' }, { fetchImpl });
    await client.submitFiletrans('https://oss.example/audio.m4a', { speech: { modelId: 'job-model' } });
    expect(fetchImpl.mock.calls[0][0]).toContain('https://bailian-proxy.example/api/v1/services/audio/asr/transcription');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('job-model');
  });

  it('keeps Bailian error diagnostics and retries only an explicit OSS URL fetch rejection', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, headers: { get: () => null }, text: async () => JSON.stringify({ code: 'BadRequest.FileDownloadFailed', message: 'fetch failed', request_id: 'req-first' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ request_id: 'req-second', output: { task_id: 'task-retried' } }) });
    const client = new BailianClient(profile, { fetchImpl });
    await expect(client.submitFiletrans('https://oss.example/audio.m4a', { sourceLanguageMode: 'auto' })).resolves.toEqual({ externalTaskId: 'task-retried', requestId: 'req-second' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].headers).not.toHaveProperty('X-DashScope-OssResourceResolve');
    expect(fetchImpl.mock.calls[1][1].headers).toMatchObject({ 'X-DashScope-OssResourceResolve': 'enable' });
  });

  it('preserves a non-retriable provider code, request id and HTTP status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, headers: { get: () => null }, text: async () => JSON.stringify({ code: 'InvalidApiKey', message: 'Invalid API key.', request_id: 'req-auth' }) });
    const client = new BailianClient(profile, { fetchImpl });
    await expect(client.submitFiletrans('https://oss.example/audio.m4a', { sourceLanguageMode: 'auto' })).rejects.toMatchObject({ code: 'InvalidApiKey', requestId: 'req-auth', status: 401, message: 'Invalid API key.' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('normalizes Filetrans sentences into portable segments', () => {
    expect(normalizeTranscript({ transcripts: [{ sentences: [{ begin_time: 4, end_time: 8, speaker_id: 0, text: 'hello' }] }] })).toEqual({ segments: [{ id: 'seg-0001', startMs: 4, endMs: 8, speakerId: 'S01', text: 'hello' }] });
  });

  it('retries a malformed marker batch with a strict prompt', async () => {
    const client = { chat: vi.fn().mockResolvedValueOnce('bad').mockResolvedValueOnce('<<<SEG:seg-1>>>\n你好\n<<<END_SEG>>>') };
    await expect(translateSegments(client, { targetLanguage: 'zh' }, [{ id: 'seg-1', text: 'hello' }])).resolves.toEqual({ segments: [{ id: 'seg-1', text: 'hello', translatedText: '你好' }] });
    expect(client.chat).toHaveBeenCalledTimes(2);
  });

  it('enforces marker and summary source integrity', () => {
    expect(() => parseMarkerBatch('<<<SEG:x>>>\na\n<<<END_SEG>>>', ['seg-1'])).toThrow(/unknown/i);
    expect(() => parseSummary('{"summary":"x","actions":[{"text":"x","sourceSegmentIds":["bad"]}]}', new Set(['seg-1']))).toThrow(/unknown/i);
  });
});
