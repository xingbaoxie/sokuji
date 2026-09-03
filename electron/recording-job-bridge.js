const { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { createUploadProgressReporter, mergeTranscriptAndTranslation, runRecordingJob, waitForRemoteTask } = require('./recording-job-runner');
const { privateSpeechEngine, RecordingRuntimeClient } = require('./recording-runtime-client');
const { PROVIDER_IDS, RecordingProviderRegistry, STAGES, normalizeSelection, selectedSpeechCapability } = require('./recording-provider-registry');
const { AliyunOssClient, BailianClient, normalizeTranscript, objectKey, summarizeSegments, translateSegments } = require('./aliyun-cloud-client');
const { SPEECH_PROFILE_IDS, TEXT_PROFILE_IDS } = require('./recording-processing-settings');

const AUDIO_EXTENSIONS = new Set(['.m4a', '.mp3', '.wav', '.aac', '.flac']);
const activeRuntimeClients = new Map();

function jobsRoot(app) {
  return path.join(app.getPath('userData'), 'recording-jobs');
}

async function migrateLegacyConnectionProfiles(credentialStore, aliyunProfileStore, legacyProfileId) {
  if (!legacyProfileId) return;
  await Promise.all([
    credentialStore.copy(legacyProfileId, SPEECH_PROFILE_IDS['private-moss']),
    credentialStore.copy(legacyProfileId, SPEECH_PROFILE_IDS['private-funasr']),
    credentialStore.copy(legacyProfileId, TEXT_PROFILE_IDS.translation['private-runtime']),
    credentialStore.copy(legacyProfileId, TEXT_PROFILE_IDS.summary['private-runtime']),
    aliyunProfileStore.copy(legacyProfileId, SPEECH_PROFILE_IDS['aliyun-cloud']),
    aliyunProfileStore.copy(legacyProfileId, TEXT_PROFILE_IDS.translation['aliyun-cloud']),
    aliyunProfileStore.copy(legacyProfileId, TEXT_PROFILE_IDS.summary['aliyun-cloud']),
  ]);
}

function jobPath(app, jobId) {
  return path.join(jobsRoot(app), jobId, 'job.json');
}

function artifactsDirectory(app, jobId) {
  return path.join(jobsRoot(app), jobId, 'artifacts');
}

async function saveAtomic(filePath, value) {
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, filePath);
}

function publicJob(job) {
  return {
    jobId: job.jobId,
    sourceFileName: job.sourceFileName,
    sourcePath: job.sourcePath,
    status: job.status,
    config: job.config,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.completedAt ? { completedAt: job.completedAt } : {}),
    stageRuns: job.stageRuns || [],
    artifacts: job.artifacts || [],
    ...(job.cancellationRequested ? { cancellationRequested: true } : {}),
    ...(job.remoteTaskIds ? { remoteTaskIds: job.remoteTaskIds } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

function formatSrtTime(milliseconds) {
  const totalMilliseconds = Math.max(0, Math.floor(milliseconds || 0));
  const hours = Math.floor(totalMilliseconds / 3600000);
  const minutes = Math.floor(totalMilliseconds % 3600000 / 60000);
  const seconds = Math.floor(totalMilliseconds % 60000 / 1000);
  const remainder = totalMilliseconds % 1000;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':') + `,${String(remainder).padStart(3, '0')}`;
}

function runtimeArtifacts(job, result) {
  const transcript = result.transcript || { segments: [] };
  const artifacts = [
    { kind: 'transcript-json', fileName: 'transcript.json', content: `${JSON.stringify(transcript, null, 2)}\n` },
    { kind: 'subtitle-srt', fileName: 'transcript.srt', content: transcript.segments.map((segment, index) => `${index + 1}\n${formatSrtTime(segment.startMs)} --> ${formatSrtTime(segment.endMs)}\n${segment.speakerId ? `[${segment.speakerId}] ` : ''}${segment.text || ''}\n`).join('\n') },
  ];
  if (result.translation) artifacts.push({ kind: 'translation-json', fileName: 'translation.json', content: `${JSON.stringify(result.translation, null, 2)}\n` });
  if (result.summary) artifacts.push({ kind: 'summary-json', fileName: 'summary.json', content: `${JSON.stringify(result.summary, null, 2)}\n` });
  if (job.config.summary?.enabled && result.summary) {
    artifacts.push({ kind: 'report-markdown', fileName: 'report.md', content: `# Recording report\n\n- Source: ${job.sourceFileName}\n- Provider: ${job.config.speech.providerId}\n- Model: ${job.config.speech.modelId || job.config.speech.engineId}\n\n## Summary\n\n${JSON.stringify(result.summary, null, 2)}\n\n## Transcript\n\n${transcript.segments.map((segment) => `[${segment.speakerId || 'unknown'}] ${segment.text || ''}`).join('\n')}\n` });
  }
  return artifacts;
}

async function materializeRuntimeArtifacts(app, job, result) {
  if (job.artifacts?.length) return job;
  const directory = artifactsDirectory(app, job.jobId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const generated = runtimeArtifacts(job, result);
  await Promise.all(generated.map((artifact) => writeFile(path.join(directory, artifact.fileName), artifact.content, { encoding: 'utf8', mode: 0o600 })));
  return { ...job, artifacts: generated.map(({ kind, fileName }) => ({ kind, fileName })) };
}

async function updatePrivateRuntimeStage(app, jobId, stage, status, remoteTaskId, details = {}) {
  const job = await loadJob(app, jobId);
  if (job.status === 'cancelled') return;
  const progress = Number.isFinite(details.progress) ? Math.max(0, Math.min(99, Math.floor(details.progress))) : 50;
  const stageRuns = job.stageRuns.map((run) => run.stage === stage ? { ...run, status, progress: status === 'completed' ? 100 : progress, ...(remoteTaskId ? { remoteTaskId } : {}) } : run);
  await saveAtomic(jobPath(app, jobId), { ...job, status: remoteTaskId ? 'waiting_remote' : 'running', stageRuns, updatedAt: new Date().toISOString() });
}

async function executePrivateRuntimeJob(app, jobId, speechClient, stageClients = {}) {
  activeRuntimeClients.set(jobId, speechClient);
  try {
    const job = await loadJob(app, jobId);
    if (job.cancellationRequested) {
      await saveAtomic(jobPath(app, jobId), { ...job, status: 'cancelled', cancellationRequested: false, updatedAt: new Date().toISOString() });
      return;
    }
    const result = await runRecordingJob(job, speechClient, (stage, status, remoteTaskId, details) => updatePrivateRuntimeStage(app, jobId, stage, status, remoteTaskId, details), stageClients);
    const latest = await loadJob(app, jobId);
    if (latest.status === 'cancelled') return;
    const completed = await materializeRuntimeArtifacts(app, { ...latest, status: 'completed', remoteTaskIds: result.taskIds }, result);
    completed.completedAt = new Date().toISOString();
    completed.updatedAt = completed.completedAt;
    await saveAtomic(jobPath(app, jobId), completed);
  } catch (error) {
    const job = await loadJob(app, jobId);
    if (job.cancellationRequested) {
      await saveAtomic(jobPath(app, jobId), { ...job, status: 'cancelled', cancellationRequested: false, updatedAt: new Date().toISOString() });
    } else if (job.status !== 'cancelled') {
      await saveAtomic(jobPath(app, jobId), { ...job, status: 'failed', error: privateRuntimeFailureDetails(error), updatedAt: new Date().toISOString() });
    }
  } finally {
    activeRuntimeClients.delete(jobId);
  }
}

async function updateCloudStage(app, jobId, stage, status, details = {}) {
  const job = await loadJob(app, jobId);
  if (job.status === 'cancelled') return job;
  const progress = Number.isFinite(details.progress) ? Math.max(0, Math.min(99, Math.floor(details.progress))) : 50;
  const stageRuns = job.stageRuns.map((run) => run.stage === stage ? { ...run, status, progress: status === 'completed' ? 100 : progress, ...details } : run);
  const jobStatus = job.status === 'completed' ? 'completed' : status === 'waiting_remote' ? 'waiting_remote' : 'running';
  const next = { ...job, status: jobStatus, stageRuns, ...(details.cloud ? { cloud: { ...(job.cloud || {}), ...details.cloud } } : {}), updatedAt: new Date().toISOString() };
  await saveAtomic(jobPath(app, jobId), next);
  return next;
}

function privateRuntimeFailureDetails(error) {
  const message = typeof error?.message === 'string' ? error.message : 'Private Runtime job failed.';
  return {
    code: typeof error?.code === 'string' && error.code ? error.code : 'PRIVATE_RUNTIME_FAILED',
    message,
    ...(Number.isFinite(error?.status) && error.status > 0 ? { httpStatus: error.status } : {}),
  };
}

function cloudFailureDetails(error) {
  const message = error instanceof Error ? error.message : 'Aliyun Cloud job failed.';
  const providerCode = typeof error?.code === 'string' && error.code ? error.code : undefined;
  const httpStatus = Number.isFinite(error?.status) && error.status > 0 ? error.status : undefined;
  const requestId = typeof error?.requestId === 'string' && error.requestId ? error.requestId : undefined;
  return {
    code: 'ALIYUN_CLOUD_FAILED',
    message,
    ...(providerCode ? { providerCode } : {}),
    ...(httpStatus ? { httpStatus } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

async function waitForCloudTask(client, taskId) {
  for (;;) {
    const task = await client.getTask(taskId);
    const output = task.output || {};
    const state = output.task_status;
    if (state === 'SUCCEEDED') {
      const result = output.results?.[0];
      if (!result || result.subtask_status !== 'SUCCEEDED' || !result.transcription_url) throw new Error(result?.message || result?.code || 'Filetrans subtask failed.');
      return { task, transcriptionUrl: result.transcription_url };
    }
    if (['FAILED', 'CANCELED', 'CANCELLED'].includes(state)) throw new Error(output.message || `Filetrans task ${state}.`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

async function executeAliyunCloudJob(app, jobId, profileStore, cloudFactory = null, credentialStore = null) {
  let cloud;
  try {
    let job = await loadJob(app, jobId);
    const profile = await profileStore.resolve(job.config.speech.connectionProfileId);
    const oss = cloudFactory?.oss ? cloudFactory.oss(profile) : new AliyunOssClient(profile);
    const client = cloudFactory?.bailian ? cloudFactory.bailian(profile) : new BailianClient(profile);
    cloud = { async cancel(taskId) { return client.cancelTask(taskId); } };
    activeRuntimeClients.set(jobId, cloud);
    let transcript;
    let taskId = job.cloud?.externalTaskId;
    if (!taskId) {
      // The desktop app deliberately treats a selected file as opaque.  Media
      // validity belongs to Filetrans; do not locally probe or remux it.
      await updateCloudStage(app, jobId, 'audio.prepare', 'running', { progress: 0 });
      job = await loadJob(app, jobId);
      const key = objectKey(profile, jobId, path.basename(job.sourcePath));
      const upload = createUploadProgressReporter(
        (stage, status, _remoteTaskId, details) => updateCloudStage(app, jobId, stage, status, details),
        'audio.prepare',
      );
      await oss.upload(key, job.sourcePath, { onUploadProgress: upload.report });
      await upload.finish();
      await updateCloudStage(app, jobId, 'audio.prepare', 'completed');
      await updateCloudStage(app, jobId, 'speech.execute', 'running', { cloud: { ossObjectKey: key, cleanupAfter: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() } });
      const submitted = await client.submitFiletrans(await oss.signedGetUrl(key), job.config);
      if (!submitted.externalTaskId) throw new Error('Bailian Filetrans did not return a task id.');
      taskId = submitted.externalTaskId;
      await updateCloudStage(app, jobId, 'speech.execute', 'waiting_remote', { externalTaskId: taskId, requestId: submitted.requestId, cloud: { externalTaskId: taskId, requestId: submitted.requestId, ossObjectKey: key } });
    } else {
      await updateCloudStage(app, jobId, 'speech.execute', 'waiting_remote', { externalTaskId: taskId });
    }
    const remote = await waitForCloudTask(client, taskId);
    transcript = normalizeTranscript(await client.downloadTranscript(remote.transcriptionUrl));
    await updateCloudStage(app, jobId, 'speech.execute', 'completed', { cloud: { transcript } });
    job = await loadJob(app, jobId);
    const privateClients = new Map();
    const requirePrivateClient = async (profileId) => {
      if (!credentialStore) throw new Error('Private Runtime credentials are unavailable.');
      if (!privateClients.has(profileId)) privateClients.set(profileId, new RecordingRuntimeClient(await credentialStore.connection(profileId)));
      return privateClients.get(profileId);
    };
    let translation = null;
    if (job.config.translation?.enabled) {
      await updateCloudStage(app, jobId, 'translation.execute', 'running');
      if (job.config.translation.providerId === PROVIDER_IDS.PRIVATE_RUNTIME) {
        const runtime = await requirePrivateClient(job.config.translation.connectionProfileId);
        const request = await runtime.submit('translation', { profileRevision: job.config.translation.profileRevision || 'development', modelId: job.config.translation.modelId, segments: transcript.segments.map((segment) => ({ ...segment, sourceText: segment.text })) });
        await updateCloudStage(app, jobId, 'translation.execute', 'waiting_remote', { remoteTaskId: request.taskId });
        translation = await waitForRemoteTask(runtime, request.taskId);
      } else {
        const translationProfile = await profileStore.resolve(job.config.translation.connectionProfileId);
        const translationClient = cloudFactory?.bailian ? cloudFactory.bailian(translationProfile) : new BailianClient(translationProfile);
        translation = await translateSegments(translationClient, job.config, transcript.segments);
      }
      await updateCloudStage(app, jobId, 'translation.execute', 'completed', { cloud: { translation } });
    }
    let summary = null;
    if (job.config.summary?.enabled) {
      if (['translated', 'bilingual'].includes(job.config.summary.inputMode) && !translation) throw new Error('Summary input requires completed translation.');
      const summarySegments = mergeTranscriptAndTranslation(transcript.segments, translation);
      await updateCloudStage(app, jobId, 'summary.execute', 'running');
      if (job.config.summary.providerId === PROVIDER_IDS.PRIVATE_RUNTIME) {
        const runtime = await requirePrivateClient(job.config.summary.connectionProfileId);
        const request = await runtime.submit('summary', {
          profileRevision: job.config.summary.profileRevision || 'development', modelId: job.config.summary.modelId,
          inputMode: job.config.summary.inputMode, segments: summarySegments,
        });
        await updateCloudStage(app, jobId, 'summary.execute', 'waiting_remote', { remoteTaskId: request.taskId });
        summary = await waitForRemoteTask(runtime, request.taskId);
      } else {
        const summaryProfile = await profileStore.resolve(job.config.summary.connectionProfileId);
        const summaryClient = cloudFactory?.bailian ? cloudFactory.bailian(summaryProfile) : new BailianClient(summaryProfile);
        summary = await summarizeSegments(summaryClient, job.config, summarySegments);
      }
      await updateCloudStage(app, jobId, 'summary.execute', 'completed', { cloud: { summary } });
    }
    if (job.config.summary?.enabled) await updateCloudStage(app, jobId, 'report.build', 'running');
    const latest = await loadJob(app, jobId); if (latest.status === 'cancelled') return;
    const completed = await materializeRuntimeArtifacts(app, {
      ...latest,
      status: 'completed',
      remoteTaskIds: { speech: taskId },
      stageRuns: latest.stageRuns.map((stage) => stage.stage === 'report.build' && latest.config.summary?.enabled ? { ...stage, status: 'completed', progress: 100 } : stage),
    }, { transcript, translation, summary });
    completed.completedAt = new Date().toISOString(); completed.updatedAt = completed.completedAt; await saveAtomic(jobPath(app, jobId), completed);
    if (latest.cloud?.ossObjectKey) {
      await updateCloudStage(app, jobId, 'cloud.cleanup', 'running');
      try { await oss.remove(latest.cloud.ossObjectKey); await updateCloudStage(app, jobId, 'cloud.cleanup', 'completed'); }
      catch (error) {
        const failure = cloudFailureDetails(error);
        await updateCloudStage(app, jobId, 'cloud.cleanup', 'failed', { error: failure.message, errorCode: failure.providerCode || failure.code, ...(failure.requestId ? { requestId: failure.requestId } : {}) });
      }
    }
  } catch (error) {
    const job = await loadJob(app, jobId);
    if (job.status !== 'cancelled') {
      const failure = cloudFailureDetails(error);
      const stageRuns = job.stageRuns.map((stage) => stage.stage === 'speech.execute' && ['running', 'waiting_remote'].includes(stage.status)
        ? { ...stage, status: 'failed', progress: 100, error: failure.message, errorCode: failure.providerCode || failure.code, ...(failure.requestId ? { requestId: failure.requestId } : {}) }
        : stage);
      await saveAtomic(jobPath(app, jobId), { ...job, status: 'failed', stageRuns, error: failure, updatedAt: new Date().toISOString() });
    }
  } finally { activeRuntimeClients.delete(jobId); }
}

async function resumeAliyunCloudJobs(app, profileStore, cloudFactory, credentialStore = null) {
  try {
    const entries = await readdir(jobsRoot(app), { withFileTypes: true });
    for (const entry of entries.filter((item) => item.isDirectory())) {
      try {
        const job = await loadJob(app, entry.name);
        if (job.config?.speech?.providerId === PROVIDER_IDS.ALIYUN_CLOUD && ['waiting_remote', 'running'].includes(job.status) && job.cloud?.externalTaskId) void executeAliyunCloudJob(app, job.jobId, profileStore, cloudFactory, credentialStore);
      } catch { /* one historical job must not prevent startup */ }
    }
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

async function resumePrivateRuntimeJobs(app, credentialStore, aliyunProfileStore = null, cloudFactory = null) {
  try {
    const entries = await readdir(jobsRoot(app), { withFileTypes: true });
    for (const entry of entries.filter((item) => item.isDirectory())) {
      try {
        const job = await loadJob(app, entry.name);
        const remoteTaskId = job.remoteTaskIds?.speech || job.stageRuns?.find((stage) => stage.stage === 'speech.execute')?.remoteTaskId;
        if (job.privateRuntime && ['waiting_remote', 'running'].includes(job.status) && remoteTaskId) {
          const client = new RecordingRuntimeClient(await credentialStore.connection(job.config.speech.connectionProfileId));
          const translationClient = job.config.translation?.enabled && job.config.translation.providerId === PROVIDER_IDS.PRIVATE_RUNTIME
            ? new RecordingRuntimeClient(await credentialStore.connection(job.config.translation.connectionProfileId)) : client;
          const summaryClient = job.config.summary?.enabled && job.config.summary.providerId === PROVIDER_IDS.PRIVATE_RUNTIME
            ? new RecordingRuntimeClient(await credentialStore.connection(job.config.summary.connectionProfileId)) : client;
          let cloudAdapter = null;
          if (aliyunProfileStore && ((job.config.translation?.enabled && job.config.translation.providerId === PROVIDER_IDS.ALIYUN_CLOUD) || (job.config.summary?.enabled && job.config.summary.providerId === PROVIDER_IDS.ALIYUN_CLOUD))) {
            const translationProfile = job.config.translation?.enabled && job.config.translation.providerId === PROVIDER_IDS.ALIYUN_CLOUD
              ? await aliyunProfileStore.resolve(job.config.translation.connectionProfileId) : null;
            const summaryProfile = job.config.summary?.enabled && job.config.summary.providerId === PROVIDER_IDS.ALIYUN_CLOUD
              ? await aliyunProfileStore.resolve(job.config.summary.connectionProfileId) : null;
            const translationCloudClient = translationProfile && (cloudFactory?.bailian ? cloudFactory.bailian(translationProfile) : new BailianClient(translationProfile));
            const summaryCloudClient = summaryProfile && (cloudFactory?.bailian ? cloudFactory.bailian(summaryProfile) : new BailianClient(summaryProfile));
            cloudAdapter = {
              translate: (stageConfig, segments) => translateSegments(translationCloudClient, stageConfig, segments),
              summarize: (stageConfig, segments) => summarizeSegments(summaryCloudClient, stageConfig, segments),
            };
          }
          void executePrivateRuntimeJob(app, job.jobId, client, { translationClient, summaryClient, cloudAdapter });
        } else if (job.privateRuntime && ['waiting_remote', 'running'].includes(job.status)) {
          await saveAtomic(jobPath(app, job.jobId), {
            ...job,
            status: 'failed',
            error: { code: 'PRIVATE_RUNTIME_RESTARTED_BEFORE_SUBMIT', message: 'The app restarted before the private Runtime returned a task id. Start a new job to retry safely.' },
            updatedAt: new Date().toISOString(),
          });
        }
      } catch { /* an old profile or one broken job must not prevent startup */ }
    }
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

function createStageRuns(config) {
  const stages = ['audio.prepare', 'speech.execute'];
  if (config.translation?.enabled) stages.push('translation.execute');
  if (config.summary?.enabled) stages.push('summary.execute', 'report.build');
  if (config.speech?.providerId === PROVIDER_IDS.ALIYUN_CLOUD) stages.push('cloud.cleanup');
  return stages.map((stage) => ({ stage, status: 'pending', progress: 0 }));
}

async function loadJob(app, jobId) {
  try {
    const job = JSON.parse(await readFile(jobPath(app, jobId), 'utf8'));
    if (job.config?.runtimeMode) delete job.config.runtimeMode;
    return job;
  } catch {
    throw new Error('Recording job was not found.');
  }
}

async function getJob(app, jobId) {
  const job = await loadJob(app, jobId);
  return publicJob(job);
}

async function listJobs(app) {
  try {
    const entries = await readdir(jobsRoot(app), { withFileTypes: true });
    const jobs = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      try {
        const job = JSON.parse(await readFile(jobPath(app, entry.name), 'utf8'));
        if (job.simulation || job.fakeRuntime) return null;
        return publicJob(job);
      } catch { return null; }
    }));
    return jobs.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

function isSafeJobId(jobId) {
  return typeof jobId === 'string' && /^[a-zA-Z0-9_-]+$/.test(jobId);
}

async function deleteTerminalJob(app, jobId) {
  if (!isSafeJobId(jobId)) throw new Error('Invalid recording job id.');
  const job = await loadJob(app, jobId);
  if (!['completed', 'failed', 'cancelled'].includes(job.status)) {
    throw new Error('Only completed, failed, or cancelled recording jobs can be deleted.');
  }
  // Deliberately remove only Sokuji-managed job data. `sourcePath` belongs to
  // the user and can point anywhere on disk, so it is never part of deletion.
  await rm(path.join(jobsRoot(app), jobId), { recursive: true, force: true });
  return { jobId };
}

function validateStartPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid recording job request.');
  const { file, config } = payload;
  if (!file?.path || !file?.name) throw new Error('A recording file is required.');
  if (!AUDIO_EXTENSIONS.has(path.extname(file.path).toLowerCase())) throw new Error('Unsupported audio file type.');
  if (!config?.speech) throw new Error('A recording speech provider is required.');
  const speech = normalizeSelection(STAGES.SPEECH, config.speech);
  if (speech.providerId === PROVIDER_IDS.PRIVATE_RUNTIME && !['moss', 'funasr-meeting'].includes(speech.engineId)) throw new Error('Unsupported private Runtime engine.');
  return {
    file: { path: file.path, name: file.name, extension: path.extname(file.path).toLowerCase(), ...(Number.isFinite(file.sizeBytes) ? { sizeBytes: file.sizeBytes } : {}) },
    config: {
      speech,
      sourceLanguageMode: ['auto', 'mixed', 'fixed'].includes(config.sourceLanguageMode) ? config.sourceLanguageMode : 'auto',
      ...(typeof config.sourceLanguage === 'string' ? { sourceLanguage: config.sourceLanguage } : {}),
      targetLanguage: typeof config.targetLanguage === 'string' ? config.targetLanguage : 'zh',
      ...(Array.isArray(config.hotwords) ? { hotwords: config.hotwords.filter((word) => typeof word === 'string').slice(0, 200) } : {}),
      translation: {
        enabled: Boolean(config.translation?.enabled),
        ...normalizeSelection(STAGES.TRANSLATION, config.translation),
      },
      summary: {
        enabled: Boolean(config.summary?.enabled),
        ...normalizeSelection(STAGES.SUMMARY, config.summary),
        templateId: typeof config.summary?.templateId === 'string' ? config.summary.templateId : 'meeting-report-v1',
        inputMode: ['source', 'translated', 'bilingual'].includes(config.summary?.inputMode) ? config.summary.inputMode : 'bilingual',
        reportLanguage: typeof config.summary?.reportLanguage === 'string' ? config.summary.reportLanguage : 'zh',
      },
    },
  };
}

// Compatibility export for focused bridge tests and callers during the schema
// transition. Production paths use the registry instance created below.
function runtimeStatusDetail(error) {
  const message = error instanceof Error ? error.message : 'Unknown Runtime error.';
  return message.slice(0, 240);
}

async function getPrivateRuntimeStatus(credentialStore, profileId, legacySchemeOrEngine, createRuntimeClient = (connection) => new RecordingRuntimeClient(connection)) {
  const engineId = legacySchemeOrEngine === 'private-funasr' || legacySchemeOrEngine === 'funasr-meeting' ? 'funasr-meeting' : 'moss';
  const registry = new RecordingProviderRegistry({ credentialStore, aliyunProfileStore: { status: async () => ({ configured: false }) }, createRuntimeClient });
  const status = await registry.privateStatus(profileId, engineId);
  return { ...status, ...(status.engineId ? { engine: status.engineId, model: status.modelId } : {}) };
}

function registerRecordingJobBridge({ ipcMain, dialog, app, credentialStore, aliyunProfileStore, processingSettingsStore, recordingSidecarClient, cloudFactory = null }) {
  const providerRegistry = new RecordingProviderRegistry({ credentialStore, aliyunProfileStore });
  ipcMain.handle('recording:pick-audio', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose recording',
      properties: ['openFile'],
      filters: [{ name: 'Audio recordings', extensions: [...AUDIO_EXTENSIONS].map((extension) => extension.slice(1)) }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    return { path: filePath, name: path.basename(filePath), extension: path.extname(filePath).toLowerCase() };
  });

  const startPrivateRuntimeJob = async (payload) => {
    const { file, config } = validateStartPayload(payload);
    const client = await providerRegistry.privateClient(config.speech.connectionProfileId);
    const capabilities = await client.capabilities();
    const engine = privateSpeechEngine(config);
    const selectedCapability = selectedSpeechCapability(capabilities, engine);
    if (!selectedCapability?.available) throw new Error(`The private Runtime ${engine} speech worker is not enabled or has not passed its benchmark.`);
    let translationClient = null;
    let translationProfileRevision = '';
    let summaryClient = null;
    let summaryProfileRevision = '';
    if (config.translation.enabled && config.translation.providerId === PROVIDER_IDS.PRIVATE_RUNTIME) {
      translationClient = await providerRegistry.privateClient(config.translation.connectionProfileId);
      const textCapabilities = await translationClient.capabilities();
      const translationModel = (textCapabilities.translationModels || []).find((model) => model.id === config.translation.modelId);
      if (!translationModel) throw new Error('Translation is not available for the selected private Runtime.');
      translationProfileRevision = textCapabilities.runtimeProfileRevision || '';
      config.translation.modelRevision = translationModel.revision || translationModel.modelRevision || config.translation.modelRevision;
    }
    if (config.summary.enabled && config.summary.providerId === PROVIDER_IDS.PRIVATE_RUNTIME) {
      summaryClient = await providerRegistry.privateClient(config.summary.connectionProfileId);
      const textCapabilities = await summaryClient.capabilities();
      const summaryModel = (textCapabilities.summaryModels || []).find((model) => model.id === config.summary.modelId);
      if (!summaryModel) throw new Error('Summary is not available for the selected private Runtime.');
      summaryProfileRevision = textCapabilities.runtimeProfileRevision || '';
      config.summary.modelRevision = summaryModel.revision || summaryModel.modelRevision || config.summary.modelRevision;
    }
    const jobId = `rec_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const effectiveConfig = {
      ...config,
      speech: {
        ...config.speech,
        modelId: selectedCapability.model || selectedCapability.id || config.speech.modelId,
        ...(selectedCapability.modelRevision || selectedCapability.revision ? { modelRevision: selectedCapability.modelRevision || selectedCapability.revision } : {}),
        profileRevision: capabilities.runtimeProfileRevision || selectedCapability.profileRevision || config.speech.profileRevision || '',
      },
      translation: { ...config.translation, ...(translationProfileRevision ? { profileRevision: translationProfileRevision } : {}) },
      summary: { ...config.summary, ...(summaryProfileRevision ? { profileRevision: summaryProfileRevision } : {}) },
    };
    const job = {
      schemaVersion: 3, jobId, sourceFileName: file.name, sourcePath: file.path,
      status: 'queued', config: effectiveConfig, stageRuns: createStageRuns(effectiveConfig), privateRuntime: true,
      runtime: {
        engine, backend: selectedCapability.backend, model: selectedCapability.model,
        modelRevision: selectedCapability.modelRevision,
        runtimeProfileRevision: effectiveConfig.speech.profileRevision,
        outputSchemaVersion: selectedCapability.outputSchemaVersion || 1,
      },
      createdAt: now, updatedAt: now,
    };
    await mkdir(path.dirname(jobPath(app, jobId)), { recursive: true, mode: 0o700 });
    await saveAtomic(jobPath(app, jobId), job);
    let cloudAdapter = null;
    if ((effectiveConfig.translation.enabled && effectiveConfig.translation.providerId === PROVIDER_IDS.ALIYUN_CLOUD) || (effectiveConfig.summary.enabled && effectiveConfig.summary.providerId === PROVIDER_IDS.ALIYUN_CLOUD)) {
      const translationProfile = effectiveConfig.translation.enabled && effectiveConfig.translation.providerId === PROVIDER_IDS.ALIYUN_CLOUD
        ? await aliyunProfileStore.resolve(effectiveConfig.translation.connectionProfileId) : null;
      const summaryProfile = effectiveConfig.summary.enabled && effectiveConfig.summary.providerId === PROVIDER_IDS.ALIYUN_CLOUD
        ? await aliyunProfileStore.resolve(effectiveConfig.summary.connectionProfileId) : null;
      const translationCloudClient = translationProfile && (cloudFactory?.bailian ? cloudFactory.bailian(translationProfile) : new BailianClient(translationProfile));
      const summaryCloudClient = summaryProfile && (cloudFactory?.bailian ? cloudFactory.bailian(summaryProfile) : new BailianClient(summaryProfile));
      cloudAdapter = {
        translate: (stageConfig, segments) => {
          if (!translationCloudClient) throw new Error('Aliyun Cloud translation is not configured.');
          return translateSegments(translationCloudClient, stageConfig, segments);
        },
        summarize: (stageConfig, segments) => {
          if (!summaryCloudClient || !summaryProfile) throw new Error('Aliyun Cloud summary is not configured.');
          return summarizeSegments(summaryCloudClient, stageConfig, segments);
        },
      };
    }
    void executePrivateRuntimeJob(app, jobId, client, { translationClient: translationClient || client, summaryClient: summaryClient || client, cloudAdapter });
    return publicJob(job);
  };

  const startAliyunCloudJob = async (payload) => {
    const { file, config } = validateStartPayload(payload);
    if (config.speech.providerId !== PROVIDER_IDS.ALIYUN_CLOUD) throw new Error('Aliyun Cloud transcription provider is required.');
    if (!aliyunProfileStore) throw new Error('Aliyun Cloud profile store is unavailable.');
    await aliyunProfileStore.resolve(config.speech.connectionProfileId);
    const privateTextModelRevisions = {};
    for (const [stage, stageConfig] of [['translation', config.translation], ['summary', config.summary]]) {
      if (!stageConfig.enabled || stageConfig.providerId !== PROVIDER_IDS.PRIVATE_RUNTIME) continue;
      const providerStatus = await providerRegistry.status(stage, stageConfig);
      const selectedModel = (providerStatus.models || []).find((model) => model.id === stageConfig.modelId);
      if (providerStatus.state !== 'ready' || !selectedModel) {
        throw new Error(`${stage === 'translation' ? 'Translation' : 'Summary'} is not available for the selected private Runtime.`);
      }
      privateTextModelRevisions[stage] = { profileRevision: providerStatus.profileRevision || stageConfig.profileRevision || '', modelRevision: selectedModel.revision || selectedModel.modelRevision || stageConfig.modelRevision || '' };
    }
    const jobId = `rec_${crypto.randomUUID()}`; const now = new Date().toISOString();
    const speechProfile = await aliyunProfileStore.status(config.speech.connectionProfileId);
    const effectiveConfig = {
      ...config,
      speech: { ...config.speech, profileRevision: speechProfile.profileRevision || config.speech.profileRevision || '' },
      translation: { ...config.translation, ...(privateTextModelRevisions.translation || {}) },
      summary: { ...config.summary, ...(privateTextModelRevisions.summary || {}) },
    };
    const job = { schemaVersion: 3, jobId, sourceFileName: file.name, sourcePath: file.path, status: 'queued', config: effectiveConfig, stageRuns: createStageRuns(effectiveConfig), cloud: { profileRevision: speechProfile.profileRevision }, createdAt: now, updatedAt: now };
    await mkdir(path.dirname(jobPath(app, jobId)), { recursive: true, mode: 0o700 }); await saveAtomic(jobPath(app, jobId), job);
    void executeAliyunCloudJob(app, jobId, aliyunProfileStore, cloudFactory, credentialStore); return publicJob(job);
  };

  ipcMain.handle('recording:start-job', async (_event, payload) => {
    if (!processingSettingsStore) throw new Error('Recording processing settings are unavailable.');
    const config = await processingSettingsStore.get();
    if (!payload?.file) throw new Error('Choose an audio recording first.');
    return config.speech.providerId === PROVIDER_IDS.ALIYUN_CLOUD
      ? startAliyunCloudJob({ file: payload.file, config })
      : startPrivateRuntimeJob({ file: payload.file, config });
  });
  ipcMain.handle('recording:settings-get', async () => {
    if (!processingSettingsStore) throw new Error('Recording processing settings are unavailable.');
    return processingSettingsStore.get();
  });
  ipcMain.handle('recording:settings-save', async (_event, payload) => {
    if (!processingSettingsStore) throw new Error('Recording processing settings are unavailable.');
    return processingSettingsStore.save(payload?.config);
  });
  ipcMain.handle('recording:settings-status', async () => {
    if (!processingSettingsStore) throw new Error('Recording processing settings are unavailable.');
    const settings = await processingSettingsStore.get();
    return {
      settings,
      speech: await providerRegistry.status(STAGES.SPEECH, settings.speech),
    };
  });
  ipcMain.handle('recording:provider-catalog', async () => providerRegistry.publicCatalog());
  ipcMain.handle('recording:provider-status', async (_event, payload) => providerRegistry.status(payload?.stage, payload?.selection));

  ipcMain.handle('recording:list-jobs', () => listJobs(app));
  ipcMain.handle('recording:get-job', async (_event, payload) => {
    if (!payload?.jobId || typeof payload.jobId !== 'string') throw new Error('Recording job id is required.');
    return getJob(app, payload.jobId);
  });
  ipcMain.handle('recording:cancel-job', async (_event, payload) => {
    if (!payload?.jobId || typeof payload.jobId !== 'string') throw new Error('Recording job id is required.');
    const job = await loadJob(app, payload.jobId);
    if (job.status === 'completed' || job.status === 'failed') return publicJob(job);
    if (job.privateRuntime) {
      const client = activeRuntimeClients.get(job.jobId);
      const remoteTaskIds = Object.values(job.remoteTaskIds || job.stageRuns.reduce((ids, stage) => {
        if (stage.remoteTaskId) ids[stage.stage] = stage.remoteTaskId;
        return ids;
      }, {}));
      await Promise.all(remoteTaskIds.map((taskId) => client ? client.cancel(taskId).catch(() => undefined) : Promise.resolve()));
      const next = { ...job, status: remoteTaskIds.length ? 'waiting_remote' : 'cancelled', cancellationRequested: Boolean(remoteTaskIds.length), updatedAt: new Date().toISOString() };
      await saveAtomic(jobPath(app, job.jobId), next);
      return publicJob(next);
    }
    const client = activeRuntimeClients.get(job.jobId);
    if (client) {
      const remoteTaskIds = Object.values(job.remoteTaskIds || job.stageRuns.reduce((ids, stage) => {
        if (stage.remoteTaskId || stage.externalTaskId) ids[stage.stage] = stage.remoteTaskId || stage.externalTaskId;
        return ids;
      }, job.cloud?.externalTaskId ? { speech: job.cloud.externalTaskId } : {}));
      await Promise.all(remoteTaskIds.map((taskId) => client.cancel(taskId).catch(() => undefined)));
    }
    job.status = 'cancelled';
    job.updatedAt = new Date().toISOString();
    await saveAtomic(jobPath(app, job.jobId), job);
    return publicJob(job);
  });
  ipcMain.handle('recording:delete-job', async (_event, payload) => {
    if (!payload?.jobId || typeof payload.jobId !== 'string') throw new Error('Recording job id is required.');
    return deleteTerminalJob(app, payload.jobId);
  });
  ipcMain.handle('recording:export-artifact', async (_event, payload) => {
    if (!payload?.jobId || !payload?.fileName) throw new Error('Recording job id and artifact file name are required.');
    const job = await loadJob(app, payload.jobId);
    const artifact = (job.artifacts || []).find((entry) => entry.fileName === payload.fileName);
    if (!artifact) throw new Error('Recording artifact was not found.');
    const result = await dialog.showSaveDialog({ title: 'Export recording artifact', defaultPath: artifact.fileName });
    if (result.canceled || !result.filePath) return null;
    await copyFile(path.join(artifactsDirectory(app, job.jobId), artifact.fileName), result.filePath);
    return { path: result.filePath };
  });
  ipcMain.handle('recording:read-artifact', async (_event, payload) => {
    if (!payload?.jobId || !payload?.fileName) throw new Error('Recording job id and artifact file name are required.');
    const job = await loadJob(app, payload.jobId);
    const artifact = (job.artifacts || []).find((entry) => entry.fileName === payload.fileName);
    if (!artifact) throw new Error('Recording artifact was not found.');
    const content = await readFile(path.join(artifactsDirectory(app, job.jobId), artifact.fileName), 'utf8');
    return { fileName: artifact.fileName, content: content.slice(0, 512 * 1024), truncated: content.length > 512 * 1024 };
  });
  ipcMain.handle('recording:profile-status', async (_event, payload) => {
    if (!payload?.profileId || typeof payload.profileId !== 'string') throw new Error('Recording profile id is required.');
    return credentialStore.status(payload.profileId, { includeSecret: true });
  });
  ipcMain.handle('recording:profile-save-credential', async (_event, payload) => {
    if (!payload?.profileId || typeof payload.profileId !== 'string' || typeof payload.secret !== 'string') {
      throw new Error('Recording profile id and credential are required.');
    }
    await credentialStore.save(payload.profileId, payload.secret, payload.runtimeBaseUrl);
    return credentialStore.status(payload.profileId, { includeSecret: true });
  });
  ipcMain.handle('recording:profile-clear-credential', async (_event, payload) => {
    if (!payload?.profileId || typeof payload.profileId !== 'string') throw new Error('Recording profile id is required.');
    await credentialStore.remove(payload.profileId);
    return credentialStore.status(payload.profileId);
  });
  ipcMain.handle('recording:runtime-status', async (_event, payload) => {
    if (!payload?.profileId || typeof payload.profileId !== 'string') throw new Error('Recording profile id is required.');
    return providerRegistry.privateStatus(payload.profileId, payload.engineId);
  });
  // The recording settings editor is an explicit POC credential editor.  It
  // alone may restore the user-entered values; Registry and job paths keep
  // using the default redacted status response.
  ipcMain.handle('recording:aliyun-profile-status', async (_event, payload) => aliyunProfileStore.status(payload?.profileId, { includeSecrets: true }));
  ipcMain.handle('recording:aliyun-profile-save', async (_event, payload) => aliyunProfileStore.save(payload?.profileId, payload?.profile));
  ipcMain.handle('recording:aliyun-profile-clear', async (_event, payload) => aliyunProfileStore.remove(payload?.profileId));
  ipcMain.handle('recording:sidecar-status', async () => {
    if (!recordingSidecarClient) return { available: false, message: 'Recording sidecar is not configured.' };
    const reply = await recordingSidecarClient.status();
    return { available: Boolean(reply.available), message: String(reply.message || '') };
  });
  void (async () => {
    // This release replaces the old per-page configuration model. The user
    // explicitly accepted clearing historical recording jobs; credentials are
    // stored elsewhere and remain untouched.
    const migration = processingSettingsStore ? await processingSettingsStore.initialize() : { created: false };
    // Earlier development builds may already have written version 2 settings
    // while still keeping the connection under the original `default` id.
    // Copy only into missing stage profiles; never overwrite a stage-specific
    // connection the user has subsequently saved.
    if (processingSettingsStore && credentialStore && aliyunProfileStore) {
      await migrateLegacyConnectionProfiles(credentialStore, aliyunProfileStore, migration.legacyProfileId || 'default');
    }
    if (migration.upgraded || migration.created || migration.legacyProfileId) await rm(jobsRoot(app), { recursive: true, force: true });
    if (aliyunProfileStore) await resumeAliyunCloudJobs(app, aliyunProfileStore, cloudFactory, credentialStore);
    await resumePrivateRuntimeJobs(app, credentialStore, aliyunProfileStore, cloudFactory);
  })().catch(() => undefined);
}

module.exports = { AUDIO_EXTENSIONS, createStageRuns, deleteTerminalJob, executeAliyunCloudJob, executePrivateRuntimeJob, getJob, getPrivateRuntimeStatus, migrateLegacyConnectionProfiles, privateRuntimeFailureDetails, publicJob, resumeAliyunCloudJobs, resumePrivateRuntimeJobs, runtimeArtifacts, runtimeStatusDetail, selectedSpeechCapability, validateStartPayload, registerRecordingJobBridge };
