import type { RecordingAudioFile, RecordingAudioMetadata, RecordingJobConfig, RecordingJobSummary, RecordingProviderId, RecordingSpeechEngineId } from '../types/recording';

interface RecordingDesktopApi {
  invoke(channel: string, data?: unknown): Promise<unknown>;
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
}

export interface RecordingConnectionCatalogItem { id: string; providerId: RecordingProviderId; stage: 'speech' | 'translation' | 'summary'; labelKey: string; }
export interface RecordingProviderCatalog { providers: Array<{ id: RecordingProviderId; labelKey: string; stages: string[]; speechOptions: Array<{ engineId: RecordingSpeechEngineId; connectionProfileId: string; modelId?: string; labelKey: string; descriptionKey: string }> }>; connections: RecordingConnectionCatalogItem[]; }
export interface RecordingProviderStatus { state: 'unconfigured' | 'ready' | 'disabled' | 'unavailable'; detail?: string; engineId?: RecordingSpeechEngineId; modelId?: string; modelRevision?: string; profileRevision?: string; backend?: string; models?: Array<{ id: string; revision?: string; backend?: string }>; translationModels?: Array<{ id: string; revision?: string; backend?: string }>; summaryModels?: Array<{ id: string; revision?: string; backend?: string }>; components?: string[] | Record<string, string>; validatedMaxDurationSec?: number; }

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
  async processingSettingsStatus(): Promise<{ settings: RecordingJobConfig; speech: RecordingProviderStatus }> {
    return desktopApi().invoke('recording:settings-status') as Promise<{ settings: RecordingJobConfig; speech: RecordingProviderStatus }>;
  },
  async providerCatalog(): Promise<RecordingProviderCatalog> { return desktopApi().invoke('recording:provider-catalog') as Promise<RecordingProviderCatalog>; },
  async providerStatus(stage: 'speech' | 'translation' | 'summary', selection: RecordingJobConfig['speech'] | RecordingJobConfig['translation'] | RecordingJobConfig['summary']): Promise<RecordingProviderStatus> { return desktopApi().invoke('recording:provider-status', { stage, selection }) as Promise<RecordingProviderStatus>; },

  async probeAudioFile(file: RecordingAudioFile): Promise<RecordingAudioMetadata> {
    return desktopApi().invoke('recording:probe-audio', { path: file.path }) as Promise<RecordingAudioMetadata>;
  },

  async listJobs(): Promise<RecordingJobSummary[]> {
    return desktopApi().invoke('recording:list-jobs') as Promise<RecordingJobSummary[]>;
  },

  async cancelJob(jobId: string): Promise<RecordingJobSummary> {
    return desktopApi().invoke('recording:cancel-job', { jobId }) as Promise<RecordingJobSummary>;
  },

  async exportArtifact(jobId: string, fileName: string): Promise<{ path: string } | null> {
    return desktopApi().invoke('recording:export-artifact', { jobId, fileName }) as Promise<{ path: string } | null>;
  },

  async readArtifact(jobId: string, fileName: string): Promise<{ fileName: string; content: string; truncated: boolean }> {
    return desktopApi().invoke('recording:read-artifact', { jobId, fileName }) as Promise<{ fileName: string; content: string; truncated: boolean }>;
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
