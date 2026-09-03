import { create } from 'zustand';
import { recordingService } from '../services/recordingService';
import {
  defaultRecordingJobConfig,
  type RecordingAudioFile,
  type RecordingAudioMetadata,
  type RecordingJobConfig,
  type RecordingJobSummary,
} from '../types/recording';
import type { AliyunCloudProfileStatus, PrivateRuntimeStatus } from '../services/recordingService';

interface RecordingJobStore {
  file: RecordingAudioFile | null;
  metadata: RecordingAudioMetadata | null;
  config: RecordingJobConfig;
  jobs: RecordingJobSummary[];
  loading: boolean;
  error: string | null;
  credentialConfigured: boolean | null;
  runtimeBaseUrl: string;
  runtimeStatuses: Record<string, PrivateRuntimeStatus>;
  aliyunProfile: AliyunCloudProfileStatus | null;
  artifactPreview: { jobId: string; fileName: string; content: string; truncated: boolean } | null;
  setFile: (file: RecordingAudioFile | null) => void;
  setConfig: (update: Partial<RecordingJobConfig>) => void;
  setRuntimeBaseUrl: (runtimeBaseUrl: string) => void;
  pickFile: () => Promise<void>;
  hydrate: () => Promise<void>;
  start: () => Promise<void>;
  cancel: (jobId: string) => Promise<void>;
  exportArtifact: (jobId: string, fileName: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  saveCredential: (secret: string, runtimeBaseUrl: string) => Promise<void>;
  clearCredential: () => Promise<void>;
  refreshRuntimeStatus: (engineId?: 'moss' | 'funasr-meeting') => Promise<void>;
  refreshAliyunProfile: () => Promise<void>;
  saveAliyunProfile: (profile: Record<string, unknown>) => Promise<void>;
  previewArtifact: (jobId: string, fileName: string) => Promise<void>;
}

export const useRecordingJobStore = create<RecordingJobStore>()((set, get) => ({
  file: null,
  metadata: null,
  config: defaultRecordingJobConfig(),
  jobs: [],
  loading: false,
  error: null,
  credentialConfigured: null,
  runtimeBaseUrl: '',
  runtimeStatuses: {},
  aliyunProfile: null,
  artifactPreview: null,
  setFile: (file) => set({ file, metadata: null, error: null }),
  setConfig: (update) => set((state) => ({ config: { ...state.config, ...update }, error: null })),
  setRuntimeBaseUrl: (runtimeBaseUrl) => set({ runtimeBaseUrl }),
  pickFile: async () => {
    set({ loading: true, error: null });
    try {
      const file = await recordingService.pickAudioFile();
      if (file) {
        const metadata = await recordingService.probeAudioFile(file);
        set({ file, metadata });
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to select an audio file.' });
    } finally {
      set({ loading: false });
    }
  },
  hydrate: async () => {
    try {
      set({ jobs: await recordingService.listJobs() });
    } catch {
      // The feature remains usable in browser/extension development previews.
    }
  },
  start: async () => {
    const { file } = get();
    if (!file) return set({ error: 'Choose an audio recording first.' });
    set({ loading: true, error: null });
    try {
      const job = await recordingService.startJob(file);
      set((state) => ({ jobs: [job, ...state.jobs], file: null, metadata: null }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to create the recording job.' });
    } finally {
      set({ loading: false });
    }
  },
  cancel: async (jobId) => {
    try {
      const job = await recordingService.cancelJob(jobId);
      set((state) => ({ jobs: state.jobs.map((item) => item.jobId === jobId ? job : item) }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to cancel the recording job.' });
    }
  },
  exportArtifact: async (jobId, fileName) => {
    set({ loading: true, error: null });
    try {
      await recordingService.exportArtifact(jobId, fileName);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to export the recording artifact.' });
    } finally {
      set({ loading: false });
    }
  },
  refreshProfile: async () => {
    try {
      const status = await recordingService.profileStatus(get().config.speech.connectionProfileId);
      set({ credentialConfigured: status.credentialConfigured, runtimeBaseUrl: status.runtimeBaseUrl });
    } catch {
      set({ credentialConfigured: null });
    }
  },
  saveCredential: async (secret, runtimeBaseUrl) => {
    set({ loading: true, error: null });
    try {
      const status = await recordingService.saveProfileCredential(get().config.speech.connectionProfileId, secret, runtimeBaseUrl);
      set({ credentialConfigured: status.credentialConfigured, runtimeBaseUrl: status.runtimeBaseUrl });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to save the recording credential.' });
    } finally {
      set({ loading: false });
    }
  },
  clearCredential: async () => {
    set({ loading: true, error: null });
    try {
      const status = await recordingService.clearProfileCredential(get().config.speech.connectionProfileId);
      set({ credentialConfigured: status.credentialConfigured, runtimeBaseUrl: status.runtimeBaseUrl });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to remove the recording credential.' });
    } finally {
      set({ loading: false });
    }
  },
  refreshRuntimeStatus: async (engineId) => {
    const selectedEngine = engineId ?? get().config.speech.engineId;
    if (selectedEngine === 'aliyun-filetrans') return;
    try {
      const status = await recordingService.privateRuntimeStatus(get().config.speech.connectionProfileId, selectedEngine);
      set((state) => ({ runtimeStatuses: { ...state.runtimeStatuses, [selectedEngine]: status } }));
    } catch (error) {
      const status: PrivateRuntimeStatus = { state: 'unavailable', detail: error instanceof Error ? error.message : 'Recording runtime status is unavailable.' };
      set((state) => ({ runtimeStatuses: { ...state.runtimeStatuses, [selectedEngine]: status } }));
    }
  },
  refreshAliyunProfile: async () => {
    try { set({ aliyunProfile: await recordingService.aliyunProfileStatus('speech.aliyun') }); } catch { set({ aliyunProfile: null }); }
  },
  saveAliyunProfile: async (profile) => {
    set({ loading: true, error: null });
    try { set({ aliyunProfile: await recordingService.saveAliyunProfile('speech.aliyun', profile) }); }
    catch (error) { set({ error: error instanceof Error ? error.message : 'Unable to save Aliyun Cloud profile.' }); }
    finally { set({ loading: false }); }
  },
  previewArtifact: async (jobId, fileName) => {
    const currentPreview = get().artifactPreview;
    if (currentPreview?.jobId === jobId && currentPreview.fileName === fileName) {
      set({ artifactPreview: null, error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      set({ artifactPreview: { jobId, ...(await recordingService.readArtifact(jobId, fileName)) } });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to read the recording artifact.' });
    } finally {
      set({ loading: false });
    }
  },
}));
