const { normalizeSummaryResult } = require('./recording-result-normalizer');
const { renderRepairPrompt } = require('./recording-summary-templates');

async function waitForRemoteTask(client, taskId, { pollMs = 1500, timeoutMs = 2 * 60 * 60 * 1000, maxPolls = Infinity } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; attempt < maxPolls && Date.now() < deadline; attempt += 1) {
    const task = await client.getTask(taskId);
    if (task.status === 'completed') return client.getResult(taskId);
    if (task.status === 'failed' || task.status === 'cancelled') throw new Error(task.error?.message || `Remote task ${taskId} ${task.status}.`);
    if (attempt + 1 < maxPolls && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
    }
  }
  await client.cancel(taskId);
  throw new Error(`Remote task ${taskId} timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
}

function mergeTranscriptAndTranslation(transcriptSegments = [], translation = null) {
  const translatedById = new Map((translation?.segments || []).map((segment) => [segment.id, segment]));
  return transcriptSegments.map((segment) => {
    const translated = translatedById.get(segment.id);
    return translated?.translatedText === undefined ? segment : { ...segment, translatedText: translated.translatedText };
  });
}

function privateSummaryPayload(summary, segments) {
  const capabilities = summary.runtimeCapabilities || {};
  return {
    profileRevision: summary.profileRevision || 'development', modelId: summary.modelId, inputMode: summary.inputMode, segments,
    ...(capabilities.summaryTemplateMetadata ? { templateId: summary.templateId, reportLanguage: summary.reportLanguage, schemaVersion: summary.schemaVersion } : {}),
  };
}

async function normalizePrivateSummaryResult(client, summary, result) {
  try { return normalizeSummaryResult(result); }
  catch (error) {
    if (!summary.runtimeCapabilities?.summaryRepair) throw error;
    const request = await client.submit('summary', {
      profileRevision: summary.profileRevision || 'development', modelId: summary.modelId,
      repair: true, prompt: renderRepairPrompt(typeof result === 'string' ? result : JSON.stringify(result)), schemaVersion: summary.schemaVersion || 1,
    });
    return normalizeSummaryResult(await waitForRemoteTask(client, request.taskId));
  }
}

function createUploadProgressReporter(onStage, stage) {
  let lastProgress = -1;
  let closed = false;
  let failure = null;
  let queue = Promise.resolve();

  const report = (value) => {
    const progress = Math.max(0, Math.min(99, Math.floor(Number(value) || 0)));
    if (closed || progress <= lastProgress) return;
    lastProgress = progress;
    // Stream callbacks cannot await persistence. Serialize updates so a late
    // write never replaces a newer percentage in the job snapshot.
    queue = queue.then(async () => {
      try { await onStage(stage, 'running', undefined, { progress }); }
      catch (error) { failure ||= error; }
    });
  };

  return {
    report,
    async finish() {
      closed = true;
      await queue;
      if (failure) throw failure;
    },
  };
}

async function runRecordingJob(job, speechClient, onStage, { translationClient = speechClient, summaryClient = speechClient, cloudAdapter = null, onResult = null } = {}) {
  const taskIds = {}; let activeStage = 'speech.execute';
  const checkpoint = async (stage, result) => { activeStage = stage; if (onResult) await onResult(stage, result); };
  try {
  const persistedSpeechTaskId = job.remoteTaskIds?.speech || job.stageRuns?.find((stage) => stage.stage === 'speech.execute')?.remoteTaskId;
  if (persistedSpeechTaskId) {
    await onStage('audio.prepare', 'completed');
    await onStage('speech.execute', 'running');
    taskIds.speech = persistedSpeechTaskId;
    await onStage('speech.execute', 'running', persistedSpeechTaskId);
  } else {
    await onStage('audio.prepare', 'running', undefined, { progress: 0 });
    const upload = createUploadProgressReporter(onStage, 'audio.prepare');
    const speech = await speechClient.submitSpeech(
      job.sourcePath,
      job.config.speech?.profileRevision || job.config.profileRevision || 'development',
      job.config,
      { onUploadProgress: upload.report },
    );
    await upload.finish();
    await onStage('audio.prepare', 'completed');
    await onStage('speech.execute', 'running');
    taskIds.speech = speech.taskId;
    await onStage('speech.execute', 'running', speech.taskId);
  }
  const transcript = await waitForRemoteTask(speechClient, taskIds.speech);
  await checkpoint('speech.execute', transcript);
  await onStage('speech.execute', 'completed');
  let translation = null;
  if (job.config.translation?.enabled) {
    activeStage = 'translation.execute';
    await onStage('translation.execute', 'running');
    if (job.config.translation.providerId === 'aliyun-cloud') {
      if (!cloudAdapter) throw new Error('Aliyun Cloud translation is not configured.');
      translation = await cloudAdapter.translate(job.config, transcript.segments);
    } else {
      const request = await translationClient.submit('translation', { profileRevision: job.config.translation.profileRevision || 'development', modelId: job.config.translation.modelId, segments: transcript.segments.map((segment) => ({ ...segment, sourceText: segment.text })) });
      taskIds.translation = request.taskId;
      await onStage('translation.execute', 'running', request.taskId);
      translation = await waitForRemoteTask(translationClient, request.taskId);
    }
    await checkpoint('translation.execute', translation);
    await onStage('translation.execute', 'completed');
  }
  let summary = null;
  if (job.config.summary?.enabled) {
    activeStage = 'summary.execute';
    const summarySegments = mergeTranscriptAndTranslation(transcript.segments, translation);
    await onStage('summary.execute', 'running');
    if (job.config.summary.providerId === 'aliyun-cloud') {
      if (!cloudAdapter) throw new Error('Aliyun Cloud summary is not configured.');
      summary = await cloudAdapter.summarize(job.config, summarySegments);
    } else {
      const request = await summaryClient.submit('summary', privateSummaryPayload(job.config.summary, summarySegments));
      taskIds.summary = request.taskId;
      await onStage('summary.execute', 'running', request.taskId);
      summary = await normalizePrivateSummaryResult(summaryClient, job.config.summary, await waitForRemoteTask(summaryClient, request.taskId));
    }
    await checkpoint('summary.execute', summary);
    await onStage('summary.execute', 'completed');
  }
  if (job.config.summary?.enabled) {
    await onStage('report.build', 'running');
    await onStage('report.build', 'completed');
  }
  return { transcript, translation, summary, taskIds };
  } catch (error) {
    error.recordingStage ||= activeStage;
    throw error;
  }
}

module.exports = { createUploadProgressReporter, mergeTranscriptAndTranslation, normalizePrivateSummaryResult, privateSummaryPayload, runRecordingJob, waitForRemoteTask };
