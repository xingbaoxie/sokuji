import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { AUDIO_EXTENSIONS, createStageRuns, executeAliyunCloudJob, getPrivateRuntimeStatus, migrateLegacyConnectionProfiles, publicJob, runtimeArtifacts, validateStartPayload } from './recording-job-bridge.js';

const config = { speech: { providerId: 'private-runtime', connectionProfileId: 'speech.private-moss', engineId: 'moss', modelId: '' }, translation: { enabled: false, providerId: 'aliyun-cloud', connectionProfileId: 'translation.aliyun', modelId: 'qwen-mt-plus' }, summary: { enabled: false, providerId: 'aliyun-cloud', connectionProfileId: 'summary.aliyun', modelId: 'qwen3.8-max', inputMode: 'source' } };

describe('recording job bridge', () => {
  it('allows the POC audio formats only', () => {
    expect(AUDIO_EXTENSIONS.has('.m4a')).toBe(true);
    expect(AUDIO_EXTENSIONS.has('.flac')).toBe(true);
    expect(AUDIO_EXTENSIONS.has('.ogg')).toBe(false);
  });

  it('rejects an unsupported source file before persisting a job', () => {
    expect(() => validateStartPayload({ file: { path: '/tmp/recording.ogg', name: 'recording.ogg' }, config })).toThrow(/unsupported audio/i);
  });

  it('projects only the renderer-safe job fields', () => {
    const result = publicJob({
      jobId: 'rec_1', sourceFileName: 'meeting.m4a', sourcePath: '/tmp/meeting.m4a', status: 'queued', config,
      createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z', runtimeCredential: 'must-not-leak',
    });
    expect(result).not.toHaveProperty('runtimeCredential');
  });

  it('exposes the durable completion timestamp without exposing credentials', () => {
    const result = publicJob({
      jobId: 'rec_2', sourceFileName: 'meeting.m4a', sourcePath: '/tmp/meeting.m4a', status: 'completed', config,
      createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:01:25.000Z', completedAt: '2026-08-28T00:01:25.000Z',
    });
    expect(result.completedAt).toBe('2026-08-28T00:01:25.000Z');
  });

  it('does not persist unrecognized config keys such as a credential', () => {
    const validated = validateStartPayload({
      file: { path: '/tmp/meeting.m4a', name: 'meeting.m4a' },
      config: { ...config, runtimeToken: 'must-not-persist', translation: { ...config.translation, enabled: true, apiKey: 'must-not-persist' } },
    });
    expect(JSON.stringify(validated.config)).not.toMatch(/must-not-persist|apiKey|runtimeToken/);
  });

  it('keeps stage-specific profile ids and does not retain the legacy root profile', () => {
    const validated = validateStartPayload({
      file: { path: '/tmp/meeting.m4a', name: 'meeting.m4a' },
      config: { ...config, profileId: 'legacy-default', translation: { enabled: true, providerId: 'aliyun-cloud', connectionProfileId: 'translation.aliyun', modelId: 'qwen-mt-plus' }, summary: { enabled: true, providerId: 'private-runtime', connectionProfileId: 'summary.private', modelId: 'local-summary', inputMode: 'source' } },
    });
    expect(validated.config).toMatchObject({ speech: { connectionProfileId: 'speech.private-moss' }, translation: { connectionProfileId: 'translation.aliyun' }, summary: { connectionProfileId: 'summary.private' } });
    expect(validated.config).not.toHaveProperty('profileId');
  });

  it('drops a legacy runtime mode instead of accepting a simulated task request', () => {
    const validated = validateStartPayload({ file: { path: '/tmp/meeting.m4a', name: 'meeting.m4a' }, config: { ...config, runtimeMode: 'simulation' } });
    expect(validated.config).not.toHaveProperty('runtimeMode');
  });

  it('copies a legacy connection into every independent stage profile without overwriting them', async () => {
    const privateCopies = []; const cloudCopies = [];
    await migrateLegacyConnectionProfiles({ copy: async (...args) => privateCopies.push(args) }, { copy: async (...args) => cloudCopies.push(args) }, 'default');
    expect(privateCopies).toContainEqual(['default', 'speech.private-moss']);
    expect(privateCopies).toContainEqual(['default', 'summary.private']);
    expect(cloudCopies).toContainEqual(['default', 'speech.aliyun']);
    expect(cloudCopies).toContainEqual(['default', 'translation.aliyun']);
  });

  it('creates only the stages required by the selected output options', () => {
    const stages = createStageRuns({ ...config, translation: { enabled: true }, summary: { enabled: true } });
    expect(stages.map((stage) => stage.stage)).toEqual(['audio.prepare', 'speech.execute', 'translation.execute', 'summary.execute', 'report.build']);
  });

  it('does not create translation, summary or report stages when outputs are disabled', () => {
    expect(createStageRuns(config).map((stage) => stage.stage)).toEqual(['audio.prepare', 'speech.execute']);
  });

  it('renders private Runtime results into portable artifacts', () => {
    const artifacts = runtimeArtifacts({ sourceFileName: 'meeting.m4a', config }, { transcript: { segments: [{ startMs: 0, endMs: 1200, speakerId: 'S01', text: 'hello' }] } });
    expect(artifacts.find((artifact) => artifact.fileName === 'transcript.srt').content).toContain('00:00:00,000 --> 00:00:01,200');
    expect(artifacts.find((artifact) => artifact.fileName === 'report.md')).toBeUndefined();
  });

  it('reports remote MOSS readiness without returning the saved token', async () => {
    const credentialStore = {
      status: async () => ({ credentialConfigured: true, runtimeBaseUrl: 'http://runtime.internal' }),
      connection: async () => ({ baseUrl: 'http://runtime.internal', token: 'main-process-only-token' }),
    };
    const client = {
      health: async () => ({ status: 'ok', profileRevision: 'runtime-poc-1' }),
      capabilities: async () => ({ runtimeProfileRevision: 'runtime-poc-1', speech: { moss: { available: true, model: 'MOSS', backend: 'vllm' } } }),
    };
    const status = await getPrivateRuntimeStatus(credentialStore, 'default', 'private-moss', () => client);
    expect(status).toMatchObject({ state: 'ready', engine: 'moss', engineId: 'moss', model: 'MOSS', modelId: 'MOSS', backend: 'vllm', profileRevision: 'runtime-poc-1', translationModels: [], summaryModels: [] });
    expect(JSON.stringify(status)).not.toContain('main-process-only-token');
  });

  it('does not contact a Runtime when the profile has no saved credential', async () => {
    const status = await getPrivateRuntimeStatus({ status: async () => ({ credentialConfigured: false, runtimeBaseUrl: '' }) }, 'default', 'private-moss');
    expect(status).toMatchObject({ state: 'unconfigured', engineId: 'moss' });
  });

  it('resumes an existing Aliyun Filetrans task without uploading or submitting it again', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sokuji-cloud-job-'));
    const app = { getPath: () => directory };
    const jobId = 'rec_cloud_1';
    const jobDirectory = path.join(directory, 'recording-jobs', jobId);
    await mkdir(jobDirectory, { recursive: true });
    const cloudConfig = { speech: { providerId: 'aliyun-cloud', connectionProfileId: 'speech.aliyun', engineId: 'aliyun-filetrans', modelId: 'qwen-audio-3.0-asr-flash-filetrans' }, translation: { enabled: false, providerId: 'aliyun-cloud', connectionProfileId: 'translation.aliyun', modelId: 'qwen-mt-plus' }, summary: { enabled: false, providerId: 'aliyun-cloud', connectionProfileId: 'summary.aliyun', modelId: 'qwen3.8-max', inputMode: 'source' } };
    await writeFile(path.join(jobDirectory, 'job.json'), JSON.stringify({ schemaVersion: 2, jobId, sourceFileName: 'meeting.m4a', sourcePath: '/not-needed-after-submit.m4a', status: 'waiting_remote', config: cloudConfig, cloud: { externalTaskId: 'task-existing', ossObjectKey: 'key' }, stageRuns: createStageRuns(cloudConfig), createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }));
    const bailian = { getTask: async () => ({ output: { task_status: 'SUCCEEDED', results: [{ subtask_status: 'SUCCEEDED', transcription_url: 'https://result' }] } }), downloadTranscript: async () => ({ transcripts: [{ sentences: [{ begin_time: 0, end_time: 1000, text: 'hello' }] }] }), cancelTask: async () => undefined };
    try {
      await executeAliyunCloudJob(app, jobId, { resolve: async () => ({}) }, { bailian: () => bailian, oss: () => ({ upload: async () => { throw new Error('must not upload'); }, signedGetUrl: async () => 'unused', remove: async () => undefined }) });
      const complete = JSON.parse(await readFile(path.join(jobDirectory, 'job.json'), 'utf8'));
      expect(complete.status).toBe('completed');
      expect(complete.artifacts.map((item) => item.fileName)).toContain('transcript.json');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
