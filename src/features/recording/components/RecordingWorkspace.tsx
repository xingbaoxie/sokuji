import React, { useEffect } from 'react';
import { FileAudio, LoaderCircle, Play, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isElectron } from '../../../utils/environment';
import { useRecordingJobStore } from '../stores/recordingJobStore';
import { RecordingJobCard } from './RecordingJobCard';
import './RecordingWorkspace.scss';

export function formatElapsedDuration(startedAt: string, finishedAt: string, language: string): string | null {
  const elapsedMs = Date.parse(finishedAt) - Date.parse(startedAt);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  const totalSeconds = Math.max(1, Math.round(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  if (language.startsWith('zh')) return hours ? `${hours}小时${minutes}分${seconds}秒` : `${minutes}分${seconds}秒`;
  if (language.startsWith('ja')) return hours ? `${hours}時間${minutes}分${seconds}秒` : `${minutes}分${seconds}秒`;
  return hours ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;
}

export function formatJobFailure(error: { code: string; message: string; providerCode?: string } | undefined, language: string): string {
  const source = `${error?.providerCode ?? ''} ${error?.message ?? ''}`.toLowerCase();
  const locale = language.toLowerCase();
  const text = (zh: string, ja: string, en: string) => locale.startsWith('zh') ? zh : locale.startsWith('ja') ? ja : en;

  if (error?.code === 'AUDIO_UNREADABLE') return text('[失败] 远端无法读取音频文件', '[失敗] リモートで音声ファイルを読み取れません', '[Failed] Runtime could not read the audio file');
  if (error?.code === 'AUDIO_DURATION_EXCEEDED') return text('[失败] 音频时长超出服务限制', '[失敗] 音声の長さがサービス制限を超えています', '[Failed] Audio duration exceeds the service limit');
  if (error?.code === 'AUDIO_VALIDATOR_UNAVAILABLE') return text('[失败] 远端 Runtime 未就绪', '[失敗] リモート Runtime の準備ができていません', '[Failed] Remote Runtime is not ready');
  if (error?.code === 'PRIVATE_RUNTIME_FAILED') return text('[失败] 远端转写失败', '[失敗] リモート文字起こしに失敗しました', '[Failed] Remote transcription failed');

  if (/certificate|hostname|tls|oss.*(?:endpoint|host)|(?:endpoint|host).*oss/.test(source)) {
    return text('[失败] 对象存储连接失败', '[失敗] オブジェクトストレージに接続できません', '[Failed] Object storage connection failed');
  }
  if (/accesskey|access.?denied|forbidden|signature|nosuchbucket/.test(source)) {
    return text('[失败] 对象存储授权失败', '[失敗] オブジェクトストレージの認証に失敗しました', '[Failed] Object storage authorization failed');
  }
  if (/apikey|api key|unauthorized|invalid.?token/.test(source)) {
    return text('[失败] 百炼服务认证失败', '[失敗] Bailian サービスの認証に失敗しました', '[Failed] Bailian service authentication failed');
  }
  if (/file.*(?:download|fetch)|(?:download|fetch).*file|fetch failed/.test(source)) {
    return text('[失败] 云端无法读取音频文件', '[失敗] クラウドで音声ファイルを読み取れません', '[Failed] Cloud service could not read the audio file');
  }
  return text('[失败] 云端转写失败', '[失敗] クラウド文字起こしに失敗しました', '[Failed] Cloud transcription failed');
}

export function displayRecordingModelName(modelId?: string): string {
  const parts = String(modelId || '').trim().split('/').filter(Boolean);
  return parts.at(-1) || '';
}

function visibleStages(job: { config: { translation?: { enabled?: boolean }; summary?: { enabled?: boolean } }; stageRuns: Array<{ stage: string }> }) {
  return job.stageRuns.filter((stage) => {
    if (stage.stage === 'translation.execute') return job.config.translation?.enabled;
    if (stage.stage === 'summary.execute') return job.config.summary?.enabled;
    if (stage.stage === 'report.build') return false;
    return true;
  });
}

function visibleArtifacts(job: { config: { translation?: { enabled?: boolean }; summary?: { enabled?: boolean } }; artifacts: Array<{ kind: string }> }) {
  return job.artifacts.filter((artifact) => {
    if (artifact.kind === 'translation-json') return job.config.translation?.enabled;
    if (artifact.kind === 'summary-json' || artifact.kind === 'report-markdown') return job.config.summary?.enabled;
    return true;
  });
}

function isTerminalJob(status: string): boolean {
  return ['completed', 'failed', 'cancelled'].includes(status);
}

function cloudCleanupMayRemain(job: { config: { speech: { providerId: string } }; stageRuns: Array<{ stage: string; status: string }> }): boolean {
  return job.config.speech.providerId === 'aliyun-cloud'
    && job.stageRuns.some((stage) => stage.stage === 'cloud.cleanup' && stage.status !== 'completed');
}

const RecordingWorkspace: React.FC = () => {
  const { t, i18n } = useTranslation();
  const file = useRecordingJobStore((state) => state.file);
  const jobs = useRecordingJobStore((state) => state.jobs);
  const hasActiveJobs = useRecordingJobStore((state) => state.jobs.some((job) => !isTerminalJob(job.status)));
  const loading = useRecordingJobStore((state) => state.loading);
  const error = useRecordingJobStore((state) => state.error);
  const jobPreviews = useRecordingJobStore((state) => state.jobPreviews);
  const previewLoadingByJob = useRecordingJobStore((state) => state.previewLoadingByJob);
  const pickFile = useRecordingJobStore((state) => state.pickFile);
  const setDroppedFile = useRecordingJobStore((state) => state.setDroppedFile);
  const hydrate = useRecordingJobStore((state) => state.hydrate);
  const start = useRecordingJobStore((state) => state.start);
  const cancel = useRecordingJobStore((state) => state.cancel);
  const deleteJob = useRecordingJobStore((state) => state.deleteJob);
  const ensureJobPreview = useRecordingJobStore((state) => state.ensureJobPreview);
  const getTranscriptResult = useRecordingJobStore((state) => state.getTranscriptResult);
  const getTranslationResult = useRecordingJobStore((state) => state.getTranslationResult);
  const getSummaryResult = useRecordingJobStore((state) => state.getSummaryResult);
  const exportResult = useRecordingJobStore((state) => state.exportResult);
  // Lazy-loaded interface catalogs can render correctly through `t()` before
  // i18next refreshes `resolvedLanguage`, which still points at the English
  // fallback. UI-specific labels must follow the selected interface language.
  const interfaceLanguage = i18n.language || i18n.resolvedLanguage || 'en';
  const speechLabel = (job: typeof jobs[number]) => {
    const provider = job.config.speech.providerId === 'private-runtime' ? t('recording.provider.private') : t('recording.provider.aliyun');
    const engine = job.config.speech.engineId === 'moss' ? t('recording.engine.moss') : job.config.speech.engineId === 'funasr-meeting' ? t('recording.engine.funasr_meeting') : t('recording.engine.aliyun_filetrans');
    const modelName = displayRecordingModelName(job.config.speech.modelId);
    return { label: `${provider} · ${modelName || engine}`, title: modelName ? `${provider} · ${job.config.speech.modelId}` : undefined };
  };

  useEffect(() => {
    void hydrate();
    if (!hasActiveJobs) return undefined;
    const timer = window.setInterval(() => { void hydrate(); }, 3000);
    return () => window.clearInterval(timer);
  }, [hydrate, hasActiveJobs]);

  if (!isElectron()) return <main className="recording-workspace recording-workspace--unavailable"><FileAudio size={32} aria-hidden="true" /><h1>{t('recording.title')}</h1><p>{t('recording.desktopOnly')}</p></main>;

  return <main className="recording-workspace" aria-label={t('recording.title')}>
    <header className="recording-workspace__header"><h1>{t('recording.title')}</h1></header>
    <section className="recording-section" aria-labelledby="recording-file-title" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
      event.preventDefault();
      const droppedFile = event.dataTransfer.files.item(0);
      if (droppedFile) setDroppedFile(droppedFile);
    }}>
      <h2 id="recording-file-title">{t('recording.audio.title')}</h2>
      <button className="recording-file-picker" type="button" onClick={() => void pickFile()} disabled={loading}><Upload size={18} aria-hidden="true" /><span>{file ? file.name : t('recording.audio.choose')}</span></button>
      <p className="recording-hint">{t('recording.audio.formats')}</p>
      {error && <p className="recording-error" role="alert">{error}</p>}
      <button className="recording-start" type="button" onClick={() => void start()} disabled={loading || !file}>{loading ? <LoaderCircle className="recording-spinner" size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}{t('recording.startTranscription')}</button>
    </section>
    <section className="recording-section recording-history" aria-labelledby="recording-history-title">
      <h2 id="recording-history-title">{t('recording.jobs')}</h2>
      {jobs.length === 0 ? <p className="recording-hint">{t('recording.noJobs')}</p> : <ul>{jobs.map((job) => {
        const elapsed = job.status === 'completed' ? formatElapsedDuration(job.createdAt, job.completedAt ?? job.updatedAt, interfaceLanguage) : null;
        const language = interfaceLanguage;
        const confirmDelete = (target = job) => {
          const message = [
            t('recording.deleteJobConfirm', { fileName: target.sourceFileName }),
            t('recording.deleteJobDetails'),
            ...(cloudCleanupMayRemain(target) ? [t('recording.deleteJobCloudWarning')] : []),
          ].join('\n\n');
          if (window.confirm(message)) void deleteJob(target.jobId);
        };
        const speech = speechLabel(job);
        return <RecordingJobCard key={job.jobId} job={job} language={language} speechLabel={speech.label} speechTitle={speech.title} elapsed={elapsed} preview={jobPreviews[job.jobId]} previewLoading={previewLoadingByJob[job.jobId]} ensurePreview={ensureJobPreview} cancel={(jobId) => void cancel(jobId)} remove={confirmDelete} exportResult={(jobId, type) => void exportResult(job.jobId, type)} getTranscript={getTranscriptResult} getTranslation={getTranslationResult} getSummary={getSummaryResult} failureText={formatJobFailure} />;
      })}</ul>}
    </section>
  </main>;
};

export default RecordingWorkspace;
