import React, { useEffect } from 'react';
import { CircleAlert, Download, FileAudio, LoaderCircle, Play, Square, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isElectron } from '../../../utils/environment';
import { useRecordingJobStore } from '../stores/recordingJobStore';
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

function visibleStages(job: { config: { translation?: { enabled?: boolean }; summary?: { enabled?: boolean } }; stageRuns: Array<{ stage: string }> }) {
  return job.stageRuns.filter((stage) => {
    if (stage.stage === 'translation.execute') return job.config.translation?.enabled;
    if (stage.stage === 'summary.execute' || stage.stage === 'report.build') return job.config.summary?.enabled;
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

const RecordingWorkspace: React.FC = () => {
  const { t, i18n } = useTranslation();
  const file = useRecordingJobStore((state) => state.file);
  const metadata = useRecordingJobStore((state) => state.metadata);
  const jobs = useRecordingJobStore((state) => state.jobs);
  const loading = useRecordingJobStore((state) => state.loading);
  const error = useRecordingJobStore((state) => state.error);
  const artifactPreview = useRecordingJobStore((state) => state.artifactPreview);
  const pickFile = useRecordingJobStore((state) => state.pickFile);
  const hydrate = useRecordingJobStore((state) => state.hydrate);
  const start = useRecordingJobStore((state) => state.start);
  const cancel = useRecordingJobStore((state) => state.cancel);
  const exportArtifact = useRecordingJobStore((state) => state.exportArtifact);
  const previewArtifact = useRecordingJobStore((state) => state.previewArtifact);
  const speechLabel = (job: typeof jobs[number]) => {
    const provider = job.config.speech.providerId === 'private-runtime' ? t('recording.provider.private') : t('recording.provider.aliyun');
    const engine = job.config.speech.engineId === 'moss' ? t('recording.engine.moss') : job.config.speech.engineId === 'funasr-meeting' ? t('recording.engine.funasr_meeting') : t('recording.engine.aliyun_filetrans');
    return `${provider} · ${engine}`;
  };

  useEffect(() => {
    void hydrate();
    const timer = window.setInterval(() => { void hydrate(); }, 750);
    return () => window.clearInterval(timer);
  }, [hydrate]);

  if (!isElectron()) return <main className="recording-workspace recording-workspace--unavailable"><FileAudio size={32} aria-hidden="true" /><h1>{t('recording.title')}</h1><p>{t('recording.desktopOnly')}</p></main>;

  return <main className="recording-workspace" aria-label={t('recording.title')}>
    <header className="recording-workspace__header"><h1>{t('recording.title')}</h1></header>
    <section className="recording-section" aria-labelledby="recording-file-title">
      <h2 id="recording-file-title">{t('recording.audio.title')}</h2>
      <button className="recording-file-picker" type="button" onClick={() => void pickFile()} disabled={loading}><Upload size={18} aria-hidden="true" /><span>{file ? file.name : t('recording.audio.choose')}</span></button>
      <p className="recording-hint">{t('recording.audio.formats')}</p>
      {metadata && <p className="recording-hint">{t('recording.audio.metadata', { duration: Math.ceil(metadata.durationSeconds), codec: metadata.codec, sampleRate: metadata.sampleRate ? `${metadata.sampleRate} Hz` : t('recording.audio.sampleRateUnknown') })}</p>}
      {error && <p className="recording-error" role="alert">{error}</p>}
      <button className="recording-start" type="button" onClick={() => void start()} disabled={loading || !file}>{loading ? <LoaderCircle className="recording-spinner" size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}{t('recording.startTranscription')}</button>
    </section>
    <section className="recording-section recording-history" aria-labelledby="recording-history-title">
      <h2 id="recording-history-title">{t('recording.jobs')}</h2>
      {jobs.length === 0 ? <p className="recording-hint">{t('recording.noJobs')}</p> : <ul>{jobs.map((job) => {
        const elapsed = job.status === 'completed' ? formatElapsedDuration(job.createdAt, job.completedAt ?? job.updatedAt, i18n.resolvedLanguage ?? i18n.language) : null;
        const language = i18n.resolvedLanguage ?? i18n.language;
        const preview = artifactPreview?.jobId === job.jobId ? artifactPreview : null;
        return <li key={job.jobId}><div><strong>{job.sourceFileName}</strong><span>{speechLabel(job)} · {t(`recording.status.${job.status}`, { defaultValue: job.status.replace('_', ' ') })}{elapsed && ` · ${t('recording.elapsed', { duration: elapsed })}`}</span>{job.cancellationRequested && <span>{t('recording.cancellationRequested')}</span>}
          {job.status === 'failed' && <p className="recording-job-error" role="alert"><CircleAlert size={14} aria-hidden="true" />{formatJobFailure(job.error, language)}</p>}
          {job.status !== 'cancelled' && visibleStages(job).length > 0 && <div className="recording-stage-progress" aria-label={t('recording.jobProgress', { fileName: job.sourceFileName })}>{visibleStages(job).map((stage) => {
            const status = job.status === 'failed' && stage.stage === 'speech.execute' && stage.status !== 'completed' ? 'failed' : stage.status;
            return <span key={stage.stage} className={`is-${status}`} title={`${stage.stage}: ${stage.progress}%`}>{t(`recording.stage.${stage.stage.split('.')[0]}`, { defaultValue: stage.stage.split('.')[0] })} {status === 'running' ? `${stage.progress}%` : t(`recording.status.${status}`, { defaultValue: status })}</span>;
          })}</div>}
          {job.status === 'completed' && visibleArtifacts(job).length > 0 && <div className="recording-artifacts" aria-label={t('recording.artifactsFor', { fileName: job.sourceFileName })}>{visibleArtifacts(job).map((artifact) => <span key={artifact.fileName}><button type="button" aria-expanded={preview?.fileName === artifact.fileName} onClick={() => void previewArtifact(job.jobId, artifact.fileName)} disabled={loading}>{artifact.fileName}</button><button type="button" aria-label={t('recording.exportArtifact', { fileName: artifact.fileName })} onClick={() => void exportArtifact(job.jobId, artifact.fileName)} disabled={loading}><Download size={13} aria-hidden="true" /></button></span>)}</div>}
          {preview && <section className="recording-artifact-preview" aria-label={t('recording.previewArtifact', { fileName: preview.fileName })}><h3>{preview.fileName}</h3>{preview.truncated && <p className="recording-hint">{t('recording.previewLimited')}</p>}<pre>{preview.content}</pre></section>}
        </div>{(job.status === 'queued' || job.status === 'running' || job.status === 'waiting_remote') && <button type="button" className="recording-cancel" onClick={() => void cancel(job.jobId)} disabled={job.cancellationRequested}><Square size={14} aria-hidden="true" /> {t('common.cancel')}</button>}</li>;
      })}</ul>}
    </section>
  </main>;
};

export default RecordingWorkspace;
