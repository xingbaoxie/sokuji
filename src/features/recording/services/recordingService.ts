import type { RecordingAudioFile, RecordingJobConfig, RecordingJobPreview, RecordingJobSummary, RecordingProviderId, RecordingSpeechEngineId, RecordingSummaryResult, RecordingTranscriptResult, RecordingTranslationResult } from '../types/recording';

interface RecordingDesktopApi {
  invoke(channel: string, data?: unknown): Promise<unknown>;
  getPathForFile(file: File): string;
}

export const SUPPORTED_RECORDING_AUDIO_EXTENSIONS = ['.m4a', '.mp3', '.wav', '.aac', '.flac'] as const;

export function isSupportedRecordingAudioFile(fileName: string): boolean {
  const normalized = fileName.trim().toLowerCase();
  return SUPPORTED_RECORDING_AUDIO_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

export interface RecordingProfileStatus {
  profileId: string;
  credentialConfigured: boolean;
  runtimeBaseUrl: string;
  /** Returned only to the explicit recording settings editor in this POC. */
  secret?: string;
}
export interface AliyunCloudProfileStatus {
  profileId: string;
  configured: boolean;
  region: string;
  workspaceId?: string;
  apiBaseUrl?: string;
  modelId?: string;
  ossBucket?: string;
  ossEndpoint?: string;
  objectPrefix?: string;
  profileRevision?: string;
  requiresOss?: boolean;
  /** Returned only to the explicit recording settings editor in this POC. */
  dashscopeApiKey?: string;
  /** Returned only to the explicit recording settings editor in this POC. */
  ossAccessKeyId?: string;
  /** Returned only to the explicit recording settings editor in this POC. */
  ossAccessKeySecret?: string;
}

export interface RecordingSidecarStatus {
  available: boolean;
  message: string;
}
export interface TestConfigLoadResult {
  version: number;
  revision: string;
  loadedAt: string;
  processingSettings: RecordingJobConfig;
  volcengineAST2: {
    apiKey: string;
    sourceLanguage: string;
    targetLanguage: string;
    turnDetectionMode: 'Auto' | 'Push-to-Talk' | 'Push-to-Translate';
    hotWordTableId?: string;
    replacementTableId?: string;
    glossaryTableId?: string;
  };
}
export interface PrivateRuntimeStatus {
  state: 'unconfigured' | 'ready' | 'disabled' | 'unavailable';
  engineId?: RecordingSpeechEngineId;
  modelId?: string;
  modelRevision?: string;
  backend?: string;
  profileRevision?: string;
  detail?: string;
  translationModels?: Array<{ id: string; revision?: string; backend?: string }>;
  summaryModels?: Array<{ id: string; revision?: string; backend?: string }>;
  components?: string[] | Record<string, string>;
  validatedMaxDurationSec?: number;
  summaryCapabilities?: { summaryPrompt?: boolean; summaryRepair?: boolean; summaryTemplateMetadata?: boolean };
}

export interface RecordingConnectionCatalogItem { id: string; providerId: RecordingProviderId; stage: 'speech' | 'translation' | 'summary'; labelKey: string; }
export interface RecordingProviderCatalog { providers: Array<{ id: RecordingProviderId; labelKey: string; stages: string[]; speechOptions: Array<{ engineId: RecordingSpeechEngineId; connectionProfileId: string; modelId?: string; labelKey: string; descriptionKey: string }> }>; connections: RecordingConnectionCatalogItem[]; }
export interface RecordingProviderStatus { state: 'unconfigured' | 'ready' | 'disabled' | 'unavailable'; detail?: string; engineId?: RecordingSpeechEngineId; modelId?: string; modelRevision?: string; profileRevision?: string; backend?: string; models?: Array<{ id: string; revision?: string; backend?: string }>; translationModels?: Array<{ id: string; revision?: string; backend?: string }>; summaryModels?: Array<{ id: string; revision?: string; backend?: string }>; components?: string[] | Record<string, string>; validatedMaxDurationSec?: number; summaryCapabilities?: { summaryPrompt?: boolean; summaryRepair?: boolean; summaryTemplateMetadata?: boolean }; }

function desktopApi(): RecordingDesktopApi {
  const api = window.electron as RecordingDesktopApi | undefined;
  if (!api) throw new Error('Recording transcription is available in the desktop app only.');
  return api;
}

export const recordingService = {
  async pickAudioFile(): Promise<RecordingAudioFile | null> {
    return desktopApi().invoke('recording:pick-audio') as Promise<RecordingAudioFile | null>;
  },

  async startJob(file: RecordingAudioFile): Promise<RecordingJobSummary> {
    return desktopApi().invoke('recording:start-job', { file }) as Promise<RecordingJobSummary>;
  },
  async processingSettings(): Promise<RecordingJobConfig> {
    return desktopApi().invoke('recording:settings-get') as Promise<RecordingJobConfig>;
  },
  async saveProcessingSettings(config: RecordingJobConfig): Promise<RecordingJobConfig> {
    return desktopApi().invoke('recording:settings-save', { config }) as Promise<RecordingJobConfig>;
  },
  async loadTestConfig(username: string, password: string): Promise<TestConfigLoadResult> {
    return desktopApi().invoke('recording:test-config-load', { username, password }) as Promise<TestConfigLoadResult>;
  },
  async processingSettingsStatus(): Promise<{ settings: RecordingJobConfig; speech: RecordingProviderStatus }> {
    return desktopApi().invoke('recording:settings-status') as Promise<{ settings: RecordingJobConfig; speech: RecordingProviderStatus }>;
  },
  async providerCatalog(): Promise<RecordingProviderCatalog> { return desktopApi().invoke('recording:provider-catalog') as Promise<RecordingProviderCatalog>; },
  async providerStatus(stage: 'speech' | 'translation' | 'summary', selection: RecordingJobConfig['speech'] | RecordingJobConfig['translation'] | RecordingJobConfig['summary']): Promise<RecordingProviderStatus> { return desktopApi().invoke('recording:provider-status', { stage, selection }) as Promise<RecordingProviderStatus>; },

  droppedAudioFile(file: File): RecordingAudioFile | null {
    if (!isSupportedRecordingAudioFile(file.name)) return null;
    const filePath = desktopApi().getPathForFile(file);
    if (!filePath) return null;
    return { path: filePath, name: file.name, extension: file.name.slice(file.name.lastIndexOf('.')).toLowerCase() };
  },

  async listJobs(): Promise<RecordingJobSummary[]> {
    return desktopApi().invoke('recording:list-jobs') as Promise<RecordingJobSummary[]>;
  },

  async cancelJob(jobId: string): Promise<RecordingJobSummary> {
    return desktopApi().invoke('recording:cancel-job', { jobId }) as Promise<RecordingJobSummary>;
  },

  async deleteJob(jobId: string): Promise<{ jobId: string }> {
    return desktopApi().invoke('recording:delete-job', { jobId }) as Promise<{ jobId: string }>;
  },

  async exportArtifact(jobId: string, fileName: string): Promise<{ path: string } | null> {
    return desktopApi().invoke('recording:export-artifact', { jobId, fileName }) as Promise<{ path: string } | null>;
  },

  async readArtifact(jobId: string, fileName: string): Promise<{ fileName: string; content: string; truncated: boolean }> {
    return desktopApi().invoke('recording:read-artifact', { jobId, fileName }) as Promise<{ fileName: string; content: string; truncated: boolean }>;
  },
  async getJobPreview(jobId: string): Promise<RecordingJobPreview> {
    return desktopApi().invoke('recording:get-job-preview', { jobId }) as Promise<RecordingJobPreview>;
  },
  async getTranscriptResult(jobId: string): Promise<RecordingTranscriptResult> {
    return desktopApi().invoke('recording:get-transcript-result', { jobId }) as Promise<RecordingTranscriptResult>;
  },
  async getTranslationResult(jobId: string): Promise<RecordingTranslationResult> {
    return desktopApi().invoke('recording:get-translation-result', { jobId }) as Promise<RecordingTranslationResult>;
  },
  async getSummaryResult(jobId: string): Promise<RecordingSummaryResult> {
    return desktopApi().invoke('recording:get-summary-result', { jobId }) as Promise<RecordingSummaryResult>;
  },
  async exportResult(jobId: string, resultType: 'transcript-txt' | 'translation-txt' | 'report-txt' | 'report-docx'): Promise<{ path: string } | null> {
    return desktopApi().invoke('recording:export-result', { jobId, resultType }) as Promise<{ path: string } | null>;
  },

  async profileStatus(profileId: string): Promise<RecordingProfileStatus> {
    return desktopApi().invoke('recording:profile-status', { profileId }) as Promise<RecordingProfileStatus>;
  },

  async saveProfileCredential(profileId: string, secret: string, runtimeBaseUrl: string): Promise<RecordingProfileStatus> {
    return desktopApi().invoke('recording:profile-save-credential', { profileId, secret, runtimeBaseUrl }) as Promise<RecordingProfileStatus>;
  },

  async clearProfileCredential(profileId: string): Promise<RecordingProfileStatus> {
    return desktopApi().invoke('recording:profile-clear-credential', { profileId }) as Promise<RecordingProfileStatus>;
  },

  async privateRuntimeStatus(profileId: string, engineId: 'moss' | 'funasr-meeting'): Promise<PrivateRuntimeStatus> {
    return desktopApi().invoke('recording:runtime-status', { profileId, engineId }) as Promise<PrivateRuntimeStatus>;
  },
  async aliyunProfileStatus(profileId: string): Promise<AliyunCloudProfileStatus> { return desktopApi().invoke('recording:aliyun-profile-status', { profileId }) as Promise<AliyunCloudProfileStatus>; },
  async saveAliyunProfile(profileId: string, profile: Record<string, unknown>): Promise<AliyunCloudProfileStatus> { return desktopApi().invoke('recording:aliyun-profile-save', { profileId, profile }) as Promise<AliyunCloudProfileStatus>; },
  async clearAliyunProfile(profileId: string): Promise<AliyunCloudProfileStatus> { return desktopApi().invoke('recording:aliyun-profile-clear', { profileId }) as Promise<AliyunCloudProfileStatus>; },
};
