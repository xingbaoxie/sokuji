export type RecordingProviderId = 'private-runtime' | 'aliyun-cloud';
export type RecordingSpeechEngineId = 'moss' | 'funasr-meeting' | 'aliyun-filetrans';

export type SourceLanguageMode = 'auto' | 'mixed' | 'fixed';

export type RecordingJobStatus =
  | 'queued'
  | 'running'
  | 'waiting_remote'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RecordingJobConfig {
  speech: {
    providerId: RecordingProviderId;
    connectionProfileId: string;
    engineId: RecordingSpeechEngineId;
    modelId: string;
    modelRevision?: string;
    profileRevision?: string;
  };
  sourceLanguageMode: SourceLanguageMode;
  sourceLanguage?: string;
  targetLanguage: string;
  hotwords?: string[];
  translation: { enabled: boolean; providerId: RecordingProviderId; connectionProfileId: string; modelId: string; modelRevision?: string; profileRevision?: string };
  summary: {
    enabled: boolean;
    providerId: RecordingProviderId;
    connectionProfileId: string;
    modelId: string;
    modelRevision?: string;
    profileRevision?: string;
    templateId: string;
    templateVersion?: number;
    schemaVersion?: number;
    runtimeCapabilities?: { summaryPrompt?: boolean; summaryRepair?: boolean; summaryTemplateMetadata?: boolean };
    inputMode: 'source' | 'translated' | 'bilingual';
    reportLanguage: 'auto' | 'zh' | 'en' | 'ja';
  };
}

export interface RecordingAudioFile {
  path: string;
  name: string;
  extension: string;
  sizeBytes?: number;
}

export interface RecordingJobSummary {
  jobId: string;
  sourceFileName: string;
  status: RecordingJobStatus;
  config: RecordingJobConfig;
  createdAt: string;
  updatedAt: string;
  /** Recorded locally when all requested output files have been generated. */
  completedAt?: string;
  stageRuns: RecordingStageRun[];
  artifacts: RecordingArtifact[];
  error?: { code: string; message: string; providerCode?: string; httpStatus?: number; requestId?: string };
  cancellationRequested?: boolean;
}

export interface RecordingTranscriptSegment { id?: string; startMs: number; endMs: number; speakerId?: string; text: string; }
export interface RecordingTranscriptResult { segments: RecordingTranscriptSegment[]; }
export interface RecordingTranslationSegment { id?: string; startMs: number; endMs: number; speakerId?: string; text: string; translatedText: string; }
export interface RecordingTranslationResult { targetLanguage: string; segments: RecordingTranslationSegment[]; }
export interface RecordingSummaryActionItem { task: string; owner: string | null; deadline: string | null; }
export interface RecordingSummaryDiscussionPoint { title: string; content: string; }
export interface RecordingSummaryResult { topic: string; conclusions: string[]; discussionPoints: RecordingSummaryDiscussionPoint[]; actionItems: RecordingSummaryActionItem[]; keywords: string[]; }
export interface RecordingJobPreview {
  availability: { transcript: boolean; translation: boolean; summary: boolean };
  transcript?: { segmentCount: number; speakerCount: number; durationMs: number; segments: RecordingTranscriptSegment[] };
  translation?: { targetLanguage: string; texts: string[] };
  summary?: { topic: string; conclusions: string[]; actionItems: string[] };
}

export interface RecordingArtifact {
  kind: 'transcript-json' | 'subtitle-srt' | 'translation-json' | 'summary-json' | 'report-markdown';
  fileName: string;
}

export interface RecordingStageRun {
  stage: 'audio.prepare' | 'speech.execute' | 'translation.execute' | 'summary.execute' | 'report.build' | 'cloud.cleanup';
  status: 'pending' | 'running' | 'waiting_remote' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  externalTaskId?: string;
  requestId?: string;
  error?: string;
  errorCode?: string;
}

export function defaultRecordingJobConfig(): RecordingJobConfig {
  return {
    speech: { providerId: 'private-runtime', connectionProfileId: 'speech.private-moss', engineId: 'moss', modelId: '' },
    sourceLanguageMode: 'auto',
    targetLanguage: 'zh',
    // MOSS speech currently supplies transcription only; providers that
    // advertise additional capabilities can opt in later.
    translation: { enabled: false, providerId: 'aliyun-cloud', modelId: 'qwen-mt-plus', connectionProfileId: 'translation.aliyun' },
    summary: {
      enabled: false,
      providerId: 'aliyun-cloud',
      modelId: 'qwen3.8-max',
      connectionProfileId: 'summary.aliyun',
      templateId: 'general-meeting',
      inputMode: 'bilingual',
      reportLanguage: 'auto',
    },
  };
}

export function validateRecordingJobConfig(config: RecordingJobConfig): string | null {
  if (config.sourceLanguageMode === 'fixed' && !config.sourceLanguage) {
    return 'Choose a source language when using fixed language mode.';
  }
  if (config.summary.enabled && config.summary.inputMode === 'translated' && !config.translation.enabled) {
    return 'Translated summary input requires translation to be enabled.';
  }
  if (config.summary.enabled && config.summary.inputMode === 'bilingual' && !config.translation.enabled) {
    return 'Bilingual summary input requires translation to be enabled.';
  }
  return null;
}
