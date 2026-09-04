import { create } from 'zustand';
import { recordingService } from '../services/recordingService';
import {
  defaultRecordingJobConfig,
  type RecordingAudioFile,
  type RecordingJobConfig,
  type RecordingJobPreview,
  type RecordingJobSummary,
  type RecordingSummaryResult,
  type RecordingTranscriptResult,
  type RecordingTranslationResult,
} from '../types/recording';
import type { AliyunCloudProfileStatus, PrivateRuntimeStatus } from '../services/recordingService';

interface RecordingJobStore {
  file: RecordingAudioFile | null;
  config: RecordingJobConfig;
  jobs: RecordingJobSummary[];
  loading: boolean;
  error: string | null;
  credentialConfigured: boolean | null;
  runtimeBaseUrl: string;
  runtimeStatuses: Record<string, PrivateRuntimeStatus>;
  aliyunProfile: AliyunCloudProfileStatus | null;
  artifactPreview: { jobId: string; fileName: string; content: string; truncated: boolean } | null;
  jobPreviews: Record<string, RecordingJobPreview | undefined>;
  previewLoadingByJob: Record<string, boolean | undefined>;
  previewArtifactSignatures: Record<string, string | undefined>;
  resultLoadingByJob: Record<string, boolean | undefined>;
  transcriptResults: Record<string, RecordingTranscriptResult | undefined>;
  translationResults: Record<string, RecordingTranslationResult | undefined>;
  summaryResults: Record<string, RecordingSummaryResult | undefined>;
  setFile: (file: RecordingAudioFile | null) => void;
  setDroppedFile: (file: File) => void;
  setConfig: (update: Partial<RecordingJobConfig>) => void;
  setRuntimeBaseUrl: (runtimeBaseUrl: string) => void;
  pickFile: () => Promise<void>;
  hydrate: () => Promise<void>;
  start: () => Promise<void>;
  cancel: (jobId: string) => Promise<void>;
  deleteJob: (jobId: string) => Promise<void>;
  exportArtifact: (jobId: string, fileName: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  saveCredential: (secret: string, runtimeBaseUrl: string) => Promise<void>;
  clearCredential: () => Promise<void>;
  refreshRuntimeStatus: (engineId?: 'moss' | 'funasr-meeting') => Promise<void>;
  refreshAliyunProfile: () => Promise<void>;
  saveAliyunProfile: (profile: Record<string, unknown>) => Promise<void>;
  previewArtifact: (jobId: string, fileName: string) => Promise<void>;
  ensureJobPreview: (jobId: string) => Promise<void>;
  getTranscriptResult: (jobId: string) => Promise<RecordingTranscriptResult>;
  getTranslationResult: (jobId: string) => Promise<RecordingTranslationResult>;
  getSummaryResult: (jobId: string) => Promise<RecordingSummaryResult>;
  exportResult: (jobId: string, type: 'transcript-txt' | 'translation-txt' | 'report-txt' | 'report-docx') => Promise<void>;
}

export const useRecordingJobStore = create<RecordingJobStore>()((set, get) => ({
  file: null,
  config: defaultRecordingJobConfig(),
  jobs: [],
  loading: false,
  error: null,
  credentialConfigured: null,
  runtimeBaseUrl: '',
  runtimeStatuses: {},
  aliyunProfile: null,
  artifactPreview: null,
  jobPreviews: {}, previewLoadingByJob: {}, previewArtifactSignatures: {}, resultLoadingByJob: {}, transcriptResults: {}, translationResults: {}, summaryResults: {},
  setFile: (file) => set({ file, error: null }),
  setDroppedFile: (droppedFile) => {
    const file = recordingService.droppedAudioFile(droppedFile);
    if (!file) return set({ error: 'Only M4A, MP3, WAV, AAC, or FLAC audio files are supported.' });
    set({ file, error: null });
  },
  setConfig: (update) => set((state) => ({ config: { ...state.config, ...update }, error: null })),
  setRuntimeBaseUrl: (runtimeBaseUrl) => set({ runtimeBaseUrl }),
  pickFile: async () => {
    set({ loading: true, error: null });
    try {
      const file = await recordingService.pickAudioFile();
      if (file) set({ file });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to select an audio file.' });
    } finally {
      set({ loading: false });
    }
  },
  hydrate: async () => {
    try {
      const jobs = await recordingService.listJobs();
      set((state) => {
        const validIds = new Set(jobs.map((job) => job.jobId));
        const expected = (job: RecordingJobSummary) => job.artifacts.filter((artifact) => ['transcript-json', 'translation-json', 'summary-json'].includes(artifact.kind)).map((artifact) => artifact.kind).sort().join('|');
        const retainedPreviews = Object.fromEntries(Object.entries(state.jobPreviews).filter(([id]) => validIds.has(id) && state.previewArtifactSignatures[id] === expected(jobs.find((job) => job.jobId === id)!)));
        const retainedSignatures = Object.fromEntries(Object.keys(retainedPreviews).map((id) => [id, state.previewArtifactSignatures[id]]));
        return { jobs, jobPreviews: retainedPreviews, previewArtifactSignatures: retainedSignatures };
      });
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
      set((state) => ({ jobs: [job, ...state.jobs], file: null }));
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
  deleteJob: async (jobId) => {
    set({ loading: true, error: null });
    try {
      await recordingService.deleteJob(jobId);
      set((state) => ({
        jobs: state.jobs.filter((item) => item.jobId !== jobId),
        artifactPreview: state.artifactPreview?.jobId === jobId ? null : state.artifactPreview,
        jobPreviews: Object.fromEntries(Object.entries(state.jobPreviews).filter(([id]) => id !== jobId)),
        previewLoadingByJob: Object.fromEntries(Object.entries(state.previewLoadingByJob).filter(([id]) => id !== jobId)),
        previewArtifactSignatures: Object.fromEntries(Object.entries(state.previewArtifactSignatures).filter(([id]) => id !== jobId)),
        resultLoadingByJob: Object.fromEntries(Object.entries(state.resultLoadingByJob).filter(([id]) => id !== jobId)),
        transcriptResults: Object.fromEntries(Object.entries(state.transcriptResults).filter(([id]) => id !== jobId)),
        translationResults: Object.fromEntries(Object.entries(state.translationResults).filter(([id]) => id !== jobId)),
        summaryResults: Object.fromEntries(Object.entries(state.summaryResults).filter(([id]) => id !== jobId)),
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to delete the recording job.' });
    } finally {
      set({ loading: false });
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
  ensureJobPreview: async (jobId) => {
    if (get().jobPreviews[jobId] || get().previewLoadingByJob[jobId]) return;
    set((state) => ({ previewLoadingByJob: { ...state.previewLoadingByJob, [jobId]: true } }));
    try {
      const preview = await recordingService.getJobPreview(jobId);
      set((state) => {
        const job = state.jobs.find((item) => item.jobId === jobId);
        const signature = job?.artifacts.filter((artifact) => ['transcript-json', 'translation-json', 'summary-json'].includes(artifact.kind)).map((artifact) => artifact.kind).sort().join('|') || '';
        return { jobPreviews: { ...state.jobPreviews, [jobId]: preview }, previewArtifactSignatures: { ...state.previewArtifactSignatures, [jobId]: signature } };
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to load the recording result preview.' });
    } finally {
      set((state) => ({ previewLoadingByJob: { ...state.previewLoadingByJob, [jobId]: false } }));
    }
  },
  getTranscriptResult: async (jobId) => {
    const cached = get().transcriptResults[jobId]; if (cached) return cached;
    set((state) => ({ resultLoadingByJob: { ...state.resultLoadingByJob, [jobId]: true } }));
    try { const result = await recordingService.getTranscriptResult(jobId); set((state) => ({ transcriptResults: { ...state.transcriptResults, [jobId]: result } })); return result; }
    finally { set((state) => ({ resultLoadingByJob: { ...state.resultLoadingByJob, [jobId]: false } })); }
  },
  getTranslationResult: async (jobId) => {
    const cached = get().translationResults[jobId]; if (cached) return cached;
    set((state) => ({ resultLoadingByJob: { ...state.resultLoadingByJob, [jobId]: true } }));
    try { const result = await recordingService.getTranslationResult(jobId); set((state) => ({ translationResults: { ...state.translationResults, [jobId]: result } })); return result; }
    finally { set((state) => ({ resultLoadingByJob: { ...state.resultLoadingByJob, [jobId]: false } })); }
  },
  getSummaryResult: async (jobId) => {
    const cached = get().summaryResults[jobId]; if (cached) return cached;
    set((state) => ({ resultLoadingByJob: { ...state.resultLoadingByJob, [jobId]: true } }));
    try { const result = await recordingService.getSummaryResult(jobId); set((state) => ({ summaryResults: { ...state.summaryResults, [jobId]: result } })); return result; }
    finally { set((state) => ({ resultLoadingByJob: { ...state.resultLoadingByJob, [jobId]: false } })); }
  },
  exportResult: async (jobId, type) => {
    try { await recordingService.exportResult(jobId, type); }
    catch (error) { set({ error: error instanceof Error ? error.message : 'Unable to export the recording result.' }); }
  },
}));
