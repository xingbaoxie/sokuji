const { copyFile, mkdir, open, readFile, readdir, rename, rm, writeFile } = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { createUploadProgressReporter, mergeTranscriptAndTranslation, normalizePrivateSummaryResult, privateSummaryPayload, runRecordingJob, waitForRemoteTask } = require('./recording-job-runner');
const { privateSpeechEngine, RecordingRuntimeClient } = require('./recording-runtime-client');
const { PROVIDER_IDS, RecordingProviderRegistry, STAGES, normalizeSelection, selectedSpeechCapability } = require('./recording-provider-registry');
const { AliyunOssClient, BailianClient, normalizeTranscript, objectKey, summarizeSegments, translateSegments } = require('./aliyun-cloud-client');
const { SPEECH_PROFILE_IDS, TEXT_PROFILE_IDS } = require('./recording-processing-settings');
const { normalizeSummaryConfig, normalizeSummaryResult, normalizeTranscriptResult, normalizeTranslationResult } = require('./recording-result-normalizer');
const { summaryText, transcriptText, translationText, writeSummaryDocx } = require('./recording-result-exporter');

const AUDIO_EXTENSIONS = new Set(['.m4a', '.mp3', '.wav', '.aac', '.flac']);
const activeRuntimeClients = new Map();
const jobWriteQueues = new Map();

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

/** Serialize mutations for one Job without globally blocking unrelated jobs. */
async function withJobWriteLock(jobId, fn) {
  const previous = jobWriteQueues.get(jobId) || Promise.resolve();
  const operation = previous.catch(() => undefined).then(fn);
  const settled = operation.catch(() => undefined);
  jobWriteQueues.set(jobId, settled);
  try {
    return await operation;
  } finally {
    if (jobWriteQueues.get(jobId) === settled) jobWriteQueues.delete(jobId);
  }
}

async function mutateJob(app, jobId, mutate) {
  return withJobWriteLock(jobId, async () => {
    const job = await loadJob(app, jobId);
    const next = await mutate(job);
    if (!next) return job;
    next.updatedAt = new Date().toISOString();
    await saveAtomic(jobPath(app, jobId), next);
    return next;
  });
}

async function writeArtifactAtomic(filePath, content) {
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'w', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, filePath);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function publicJob(job) {
  return {
    jobId: job.jobId,
    sourceFileName: job.sourceFileName,
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
  return [
    ...stageArtifacts(job, 'speech.execute', result.transcript),
    ...(result.translation ? stageArtifacts(job, 'translation.execute', result.translation) : []),
    ...(result.summary ? stageArtifacts(job, 'summary.execute', result.summary) : []),
  ];
}

function stageArtifacts(job, stage, result) {
  if (stage === 'speech.execute') {
    const transcript = normalizeTranscriptResult(result);
    return [
      { kind: 'transcript-json', fileName: 'transcript.json', content: `${JSON.stringify(transcript, null, 2)}\n` },
      { kind: 'subtitle-srt', fileName: 'transcript.srt', content: transcript.segments.map((segment, index) => `${index + 1}\n${formatSrtTime(segment.startMs)} --> ${formatSrtTime(segment.endMs)}\n${segment.speakerId ? `[${segment.speakerId}] ` : ''}${segment.text || ''}\n`).join('\n') },
    ];
  }
  if (stage === 'translation.execute') return [{ kind: 'translation-json', fileName: 'translation.json', content: `${JSON.stringify(normalizeTranslationResult(result, job.config?.targetLanguage), null, 2)}\n` }];
  if (stage === 'summary.execute') {
    const summary = normalizeSummaryResult(result);
    return [
      { kind: 'summary-json', fileName: 'summary.json', content: `${JSON.stringify(summary, null, 2)}\n` },
      { kind: 'report-markdown', fileName: 'report.md', content: `# 录音总结报告\n\n原音频：${job.sourceFileName}\n\n${summaryText(summary)}\n` },
    ];
  }
  return [];
}

/**
 * Commit one successful stage without relying on a stale job snapshot.  The
 * artifact metadata and completed stage status become visible together.
 */
async function commitStageArtifacts(app, jobId, stage, generated) {
  return withJobWriteLock(jobId, async () => {
    const job = await loadJob(app, jobId);
    const directory = artifactsDirectory(app, jobId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const artifact of generated) await writeArtifactAtomic(path.join(directory, artifact.fileName), artifact.content);
    const byKind = new Map((job.artifacts || []).map((artifact) => [artifact.kind, artifact]));
    for (const artifact of generated) byKind.set(artifact.kind, { kind: artifact.kind, fileName: artifact.fileName });
    const stageRuns = (job.stageRuns || []).map((run) => run.stage === stage
      ? { ...run, status: 'completed', progress: 100, error: undefined, errorCode: undefined }
      : run);
    const next = { ...job, artifacts: [...byKind.values()], stageRuns };
    next.updatedAt = new Date().toISOString();
    await saveAtomic(jobPath(app, jobId), next);
    return next;
  });
}

async function checkpointStageResult(app, jobId, stage, result) {
  const job = await loadJob(app, jobId);
  return commitStageArtifacts(app, jobId, stage, stageArtifacts(job, stage, result));
}

async function updatePrivateRuntimeStage(app, jobId, stage, status, remoteTaskId, details = {}) {
  return mutateJob(app, jobId, (job) => {
    if (job.status === 'cancelled') return null;
    const progress = Number.isFinite(details.progress) ? Math.max(0, Math.min(99, Math.floor(details.progress))) : 50;
    const stageRuns = job.stageRuns.map((run) => run.stage === stage ? { ...run, status, progress: status === 'completed' ? 100 : progress, ...(remoteTaskId ? { remoteTaskId } : {}), ...(details.error ? { error: details.error } : {}) } : run);
    return { ...job, status: remoteTaskId ? 'waiting_remote' : 'running', stageRuns };
  });
}

async function executePrivateRuntimeJob(app, jobId, speechClient, stageClients = {}) {
  activeRuntimeClients.set(jobId, speechClient);
  try {
    const job = await loadJob(app, jobId);
    if (job.cancellationRequested) {
      await mutateJob(app, jobId, (latest) => ({ ...latest, status: 'cancelled', cancellationRequested: false }));
      return;
    }
    const result = await runRecordingJob(job, speechClient, (stage, status, remoteTaskId, details) => updatePrivateRuntimeStage(app, jobId, stage, status, remoteTaskId, details), {
      ...stageClients,
      onResult: (stage, value) => checkpointStageResult(app, jobId, stage, value),
    });
    const latest = await loadJob(app, jobId);
    if (latest.status === 'cancelled') return;
    await mutateJob(app, jobId, (current) => current.status === 'cancelled' ? null : ({ ...current, status: 'completed', remoteTaskIds: result.taskIds, completedAt: new Date().toISOString() }));
  } catch (error) {
    const job = await loadJob(app, jobId);
    if (job.cancellationRequested) {
      await mutateJob(app, jobId, (latest) => ({ ...latest, status: 'cancelled', cancellationRequested: false }));
    } else if (job.status !== 'cancelled') {
      const failure = privateRuntimeFailureDetails(error);
      const failedStage = error?.recordingStage || job.stageRuns.find((stage) => ['running', 'waiting_remote'].includes(stage.status))?.stage;
      await mutateJob(app, jobId, (latest) => ({ ...latest, status: 'failed', error: failure, stageRuns: latest.stageRuns.map((stage) => stage.stage === failedStage && stage.status !== 'completed' ? { ...stage, status: 'failed', progress: 100, error: failure.message, errorCode: failure.code } : stage) }));
    }
  } finally {
    activeRuntimeClients.delete(jobId);
  }
}

async function updateCloudStage(app, jobId, stage, status, details = {}) {
  return mutateJob(app, jobId, (job) => {
    if (job.status === 'cancelled') return null;
    const progress = Number.isFinite(details.progress) ? Math.max(0, Math.min(99, Math.floor(details.progress))) : 50;
    const stageRuns = job.stageRuns.map((run) => run.stage === stage ? { ...run, status, progress: status === 'completed' ? 100 : progress, ...details } : run);
    const jobStatus = job.status === 'completed' ? 'completed' : status === 'waiting_remote' ? 'waiting_remote' : 'running';
    return { ...job, status: jobStatus, stageRuns, ...(details.cloud ? { cloud: { ...(job.cloud || {}), ...details.cloud } } : {}) };
  });
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
  let cloud; let activeStage = 'speech.execute';
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
    await checkpointStageResult(app, jobId, 'speech.execute', transcript);
    await updateCloudStage(app, jobId, 'speech.execute', 'completed');
    job = await loadJob(app, jobId);
    const privateClients = new Map();
    const requirePrivateClient = async (profileId) => {
      if (!credentialStore) throw new Error('Private Runtime credentials are unavailable.');
      if (!privateClients.has(profileId)) privateClients.set(profileId, new RecordingRuntimeClient(await credentialStore.connection(profileId)));
      return privateClients.get(profileId);
    };
    let translation = null;
    if (job.config.translation?.enabled) {
      activeStage = 'translation.execute';
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
      await checkpointStageResult(app, jobId, 'translation.execute', translation);
      await updateCloudStage(app, jobId, 'translation.execute', 'completed');
    }
    let summary = null;
    if (job.config.summary?.enabled) {
      activeStage = 'summary.execute';
      if (['translated', 'bilingual'].includes(job.config.summary.inputMode) && !translation) throw new Error('Summary input requires completed translation.');
      const summarySegments = mergeTranscriptAndTranslation(transcript.segments, translation);
      await updateCloudStage(app, jobId, 'summary.execute', 'running');
      if (job.config.summary.providerId === PROVIDER_IDS.PRIVATE_RUNTIME) {
        const runtime = await requirePrivateClient(job.config.summary.connectionProfileId);
        const request = await runtime.submit('summary', privateSummaryPayload(job.config.summary, summarySegments));
        await updateCloudStage(app, jobId, 'summary.execute', 'waiting_remote', { remoteTaskId: request.taskId });
        summary = await normalizePrivateSummaryResult(runtime, job.config.summary, await waitForRemoteTask(runtime, request.taskId));
      } else {
        const summaryProfile = await profileStore.resolve(job.config.summary.connectionProfileId);
        const summaryClient = cloudFactory?.bailian ? cloudFactory.bailian(summaryProfile) : new BailianClient(summaryProfile);
        summary = await summarizeSegments(summaryClient, job.config, summarySegments);
      }
      await checkpointStageResult(app, jobId, 'summary.execute', summary);
      await updateCloudStage(app, jobId, 'summary.execute', 'completed');
    }
    if (job.config.summary?.enabled) await updateCloudStage(app, jobId, 'report.build', 'running');
    const latest = await loadJob(app, jobId); if (latest.status === 'cancelled') return;
    await mutateJob(app, jobId, (current) => current.status === 'cancelled' ? null : ({
      ...current, status: 'completed', remoteTaskIds: { ...(current.remoteTaskIds || {}), speech: taskId }, completedAt: new Date().toISOString(),
      stageRuns: current.stageRuns.map((stage) => stage.stage === 'report.build' && current.config.summary?.enabled ? { ...stage, status: 'completed', progress: 100 } : stage),
    }));
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
      const failedStage = error?.recordingStage || activeStage;
      await mutateJob(app, jobId, (latest) => ({
        ...latest, status: 'failed', error: failure,
        stageRuns: latest.stageRuns.map((stage) => stage.stage === failedStage && stage.status !== 'completed'
          ? { ...stage, status: 'failed', progress: 100, error: failure.message, errorCode: failure.providerCode || failure.code, ...(failure.requestId ? { requestId: failure.requestId } : {}) }
          : stage),
      }));
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
          await mutateJob(app, job.jobId, (latest) => ({
            ...latest,
            status: 'failed',
            error: { code: 'PRIVATE_RUNTIME_RESTARTED_BEFORE_SUBMIT', message: 'The app restarted before the private Runtime returned a task id. Start a new job to retry safely.' },
          }));
        }
      } catch { /* an old profile or one broken job must not prevent startup */ }
    }
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

async function cleanupTemporaryArtifacts(app) {
  try {
    const entries = await readdir(jobsRoot(app), { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const directory = artifactsDirectory(app, entry.name);
      try {
        const files = await readdir(directory);
        await Promise.all(files.filter((file) => file.endsWith('.tmp')).map((file) => rm(path.join(directory, file), { force: true })));
      } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }));
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
  if (!isSafeJobId(jobId)) throw new Error('Invalid recording job id.');
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

const RESULT_ARTIFACTS = Object.freeze({
  transcript: 'transcript-json', translation: 'translation-json', summary: 'summary-json',
});
const MAX_RESULT_BYTES = 10 * 1024 * 1024;

function findArtifact(job, kind) {
  const artifact = (job.artifacts || []).find((item) => item.kind === kind);
  if (!artifact) throw new Error('Recording result is not available.');
  if (path.basename(artifact.fileName) !== artifact.fileName) throw new Error('Recording result path is invalid.');
  return artifact;
}

async function readResultJson(app, jobId, type) {
  if (!isSafeJobId(jobId)) throw new Error('Invalid recording job id.');
  const job = await loadJob(app, jobId);
  const artifact = findArtifact(job, RESULT_ARTIFACTS[type]);
  const filePath = path.join(artifactsDirectory(app, jobId), artifact.fileName);
  const handle = await open(filePath, 'r');
  let parsed;
  try {
    const stat = await handle.stat();
    if (stat.size > MAX_RESULT_BYTES) throw new Error('Recording result is too large to display.');
    const raw = await handle.readFile('utf8');
    parsed = JSON.parse(raw);
  } finally { await handle.close(); }
  if (type === 'transcript') return normalizeTranscriptResult(parsed);
  if (type === 'translation') return normalizeTranslationResult({
    ...parsed,
    ...(job.config?.targetLanguage ? { targetLanguage: job.config.targetLanguage } : {}),
  });
  return normalizeSummaryResult(parsed);
}

async function getJobPreview(app, jobId) {
  if (!isSafeJobId(jobId)) throw new Error('Invalid recording job id.');
  const job = await loadJob(app, jobId);
  const availability = Object.fromEntries(Object.entries(RESULT_ARTIFACTS).map(([type, kind]) => [type, (job.artifacts || []).some((artifact) => artifact.kind === kind)]));
  const preview = { availability };
  if (availability.transcript) {
    const transcript = await readResultJson(app, jobId, 'transcript');
    preview.transcript = {
      segmentCount: transcript.segments.length,
      speakerCount: new Set(transcript.segments.map((segment) => segment.speakerId).filter(Boolean)).size,
      durationMs: transcript.segments.reduce((maximum, segment) => Math.max(maximum, segment.endMs || 0), 0),
      segments: transcript.segments.slice(0, 3),
    };
  }
  if (availability.translation) {
    const translation = await readResultJson(app, jobId, 'translation');
    preview.translation = { targetLanguage: translation.targetLanguage, texts: translation.segments.slice(0, 3).map((segment) => segment.translatedText) };
  }
  if (availability.summary) {
    const summary = await readResultJson(app, jobId, 'summary');
    preview.summary = { topic: summary.topic, conclusions: summary.conclusions.slice(0, 2), actionItems: summary.actionItems.slice(0, 2).map((item) => item.task) };
  }
  return preview;
}

async function exportResult(app, dialog, jobId, resultType) {
  if (!isSafeJobId(jobId)) throw new Error('Invalid recording job id.');
  const job = await loadJob(app, jobId);
  const [type, format] = String(resultType || '').split('-');
  if (!['transcript', 'translation', 'report'].includes(type) || !['txt', 'docx'].includes(format)) throw new Error('Unsupported recording result export.');
  if (format === 'docx' && type !== 'report') throw new Error('Only a summary report can be exported as Word.');
  const extension = format === 'docx' ? 'docx' : 'txt';
  const result = await dialog.showSaveDialog({ title: 'Export recording result', defaultPath: `${path.parse(job.sourceFileName).name}-${type}.${extension}` });
  if (result.canceled || !result.filePath) return null;
  if (type === 'transcript') await writeFile(result.filePath, transcriptText(await readResultJson(app, jobId, 'transcript')), 'utf8');
  else if (type === 'translation') await writeFile(result.filePath, translationText(await readResultJson(app, jobId, 'translation')), 'utf8');
  else {
    const summary = await readResultJson(app, jobId, 'summary');
    if (format === 'docx') await writeSummaryDocx(result.filePath, { sourceFileName: job.sourceFileName, createdAt: job.completedAt || job.updatedAt, summary });
    else await writeFile(result.filePath, summaryText(summary), 'utf8');
  }
  return { path: result.filePath };
}

function isSafeJobId(jobId) {
  return typeof jobId === 'string' && /^[a-zA-Z0-9_-]+$/.test(jobId);
}

async function deleteTerminalJob(app, jobId) {
  if (!isSafeJobId(jobId)) throw new Error('Invalid recording job id.');
  return withJobWriteLock(jobId, async () => {
    const job = await loadJob(app, jobId);
    if (!['completed', 'failed', 'cancelled'].includes(job.status)) throw new Error('Only completed, failed, or cancelled recording jobs can be deleted.');
    // Deliberately remove only Sokuji-managed job data. `sourcePath` belongs to
    // the user and can point anywhere on disk, so it is never part of deletion.
    await rm(path.join(jobsRoot(app), jobId), { recursive: true, force: true });
    return { jobId };
  });
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
        templateId: normalizeSummaryConfig({ templateId: config.summary?.templateId }).templateId,
        inputMode: ['source', 'translated', 'bilingual'].includes(config.summary?.inputMode) ? config.summary.inputMode : 'bilingual',
        reportLanguage: ['auto', 'zh', 'en', 'ja'].includes(config.summary?.reportLanguage) ? config.summary.reportLanguage : 'auto',
      },
    },
  };
}

function resolvedReportLanguage(app, value) {
  if (['zh', 'en', 'ja'].includes(value)) return value;
  const locale = String(app.getLocale?.() || '').toLowerCase();
  return locale.startsWith('ja') ? 'ja' : locale.startsWith('en') ? 'en' : 'zh';
}

function snapshotSummaryConfig(app, summary) {
  const normalized = normalizeSummaryConfig(summary);
  return {
    ...normalized,
    reportLanguage: resolvedReportLanguage(app, normalized.reportLanguage),
    templateVersion: normalized.templateVersion,
    schemaVersion: normalized.schemaVersion,
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
    let summaryRuntimeCapabilities = null;
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
      summaryRuntimeCapabilities = {
        summaryPrompt: Boolean(textCapabilities.summaryPrompt), summaryRepair: Boolean(textCapabilities.summaryRepair), summaryTemplateMetadata: Boolean(textCapabilities.summaryTemplateMetadata),
      };
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
      summary: { ...snapshotSummaryConfig(app, config.summary), ...(summaryProfileRevision ? { profileRevision: summaryProfileRevision } : {}), ...(summaryRuntimeCapabilities ? { runtimeCapabilities: summaryRuntimeCapabilities } : {}) },
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
      privateTextModelRevisions[stage] = { profileRevision: providerStatus.profileRevision || stageConfig.profileRevision || '', modelRevision: selectedModel.revision || selectedModel.modelRevision || stageConfig.modelRevision || '', ...(stage === 'summary' ? { runtimeCapabilities: providerStatus.summaryCapabilities || {} } : {}) };
    }
    const jobId = `rec_${crypto.randomUUID()}`; const now = new Date().toISOString();
    const speechProfile = await aliyunProfileStore.status(config.speech.connectionProfileId);
    const effectiveConfig = {
      ...config,
      speech: { ...config.speech, profileRevision: speechProfile.profileRevision || config.speech.profileRevision || '' },
      translation: { ...config.translation, ...(privateTextModelRevisions.translation || {}) },
      summary: { ...snapshotSummaryConfig(app, config.summary), ...(privateTextModelRevisions.summary || {}) },
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
  ipcMain.handle('recording:get-job-preview', async (_event, payload) => getJobPreview(app, payload?.jobId));
  ipcMain.handle('recording:get-transcript-result', async (_event, payload) => readResultJson(app, payload?.jobId, 'transcript'));
  ipcMain.handle('recording:get-translation-result', async (_event, payload) => readResultJson(app, payload?.jobId, 'translation'));
  ipcMain.handle('recording:get-summary-result', async (_event, payload) => readResultJson(app, payload?.jobId, 'summary'));
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
      const next = await mutateJob(app, job.jobId, (latest) => ({ ...latest, status: remoteTaskIds.length ? 'waiting_remote' : 'cancelled', cancellationRequested: Boolean(remoteTaskIds.length) }));
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
    const next = await mutateJob(app, job.jobId, (latest) => ({ ...latest, status: 'cancelled' }));
    return publicJob(next);
  });
  ipcMain.handle('recording:delete-job', async (_event, payload) => {
    if (!payload?.jobId || typeof payload.jobId !== 'string') throw new Error('Recording job id is required.');
    return deleteTerminalJob(app, payload.jobId);
  });
  ipcMain.handle('recording:export-artifact', async (_event, payload) => {
    if (!payload?.jobId || !payload?.fileName) throw new Error('Recording job id and artifact file name are required.');
    if (!isSafeJobId(payload.jobId) || path.basename(payload.fileName) !== payload.fileName) throw new Error('Invalid recording artifact request.');
    const job = await loadJob(app, payload.jobId);
    const artifact = (job.artifacts || []).find((entry) => entry.fileName === payload.fileName);
    if (!artifact) throw new Error('Recording artifact was not found.');
    const result = await dialog.showSaveDialog({ title: 'Export recording artifact', defaultPath: artifact.fileName });
    if (result.canceled || !result.filePath) return null;
    await copyFile(path.join(artifactsDirectory(app, job.jobId), artifact.fileName), result.filePath);
    return { path: result.filePath };
  });
  ipcMain.handle('recording:export-result', async (_event, payload) => exportResult(app, dialog, payload?.jobId, payload?.resultType));
  ipcMain.handle('recording:read-artifact', async (_event, payload) => {
    if (!payload?.jobId || !payload?.fileName) throw new Error('Recording job id and artifact file name are required.');
    if (!isSafeJobId(payload.jobId) || path.basename(payload.fileName) !== payload.fileName) throw new Error('Invalid recording artifact request.');
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
    await cleanupTemporaryArtifacts(app);
    if (aliyunProfileStore) await resumeAliyunCloudJobs(app, aliyunProfileStore, cloudFactory, credentialStore);
    await resumePrivateRuntimeJobs(app, credentialStore, aliyunProfileStore, cloudFactory);
  })().catch(() => undefined);
}

module.exports = { AUDIO_EXTENSIONS, cleanupTemporaryArtifacts, commitStageArtifacts, createStageRuns, deleteTerminalJob, executeAliyunCloudJob, executePrivateRuntimeJob, exportResult, getJob, getJobPreview, getPrivateRuntimeStatus, migrateLegacyConnectionProfiles, privateRuntimeFailureDetails, publicJob, readResultJson, resumeAliyunCloudJobs, resumePrivateRuntimeJobs, runtimeArtifacts, runtimeStatusDetail, selectedSpeechCapability, stageArtifacts, validateStartPayload, withJobWriteLock, registerRecordingJobBridge };
