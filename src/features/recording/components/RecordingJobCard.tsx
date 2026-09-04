import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, CircleAlert, Square, Trash2 } from 'lucide-react';
import { getLanguageOption } from '../../../utils/languages';
import type { RecordingJobPreview, RecordingJobSummary, RecordingSummaryResult, RecordingTranscriptResult, RecordingTranslationResult } from '../types/recording';
import { SummaryReportDialog } from './SummaryReportDialog';
import { TranscriptDialog } from './TranscriptDialog';
import { TranslationDialog } from './TranslationDialog';

type ResultDialog = 'transcript' | 'translation' | 'summary' | null;
const terminal = (status: string) => ['completed', 'failed', 'cancelled'].includes(status);
const stageFor = (job: RecordingJobSummary, name: string) => job.stageRuns.find((stage) => stage.stage === name);
const localized = (language: string, zh: string, ja: string, en: string) => language.startsWith('zh') ? zh : language.startsWith('ja') ? ja : en;

function stageLabel(stage: string, language: string) {
  const labels: Record<string, [string, string, string]> = {
    'audio.prepare': ['音频准备', '音声の準備', 'Audio preparation'], 'speech.execute': ['转写', '文字起こし', 'Transcription'],
    'translation.execute': ['翻译', '翻訳', 'Translation'], 'summary.execute': ['总结报告', '要約レポート', 'Summary report'],
    'cloud.cleanup': ['云端清理', 'クラウドのクリーンアップ', 'Cloud cleanup'],
  };
  return localized(language, ...(labels[stage] || [stage, stage, stage]));
}

function statusLabel(status: string, language: string) {
  const labels: Record<string, [string, string, string]> = {
    queued: ['排队中', '待機中', 'Queued'], running: ['进行中', '実行中', 'In progress'], waiting_remote: ['等待远端结果', 'リモート結果を待機中', 'Waiting for remote result'],
    completed: ['已完成', '完了', 'Completed'], failed: ['失败', '失敗', 'Failed'], cancelled: ['已取消', 'キャンセル済み', 'Cancelled'], pending: ['等待中', '待機中', 'Pending'],
  };
  return localized(language, ...(labels[status] || [status, status, status]));
}

export function RecordingJobCard({ job, language, speechLabel, speechTitle, elapsed, preview, previewLoading, ensurePreview, cancel, remove, exportResult, getTranscript, getTranslation, getSummary, failureText }: {
  job: RecordingJobSummary; language: string; speechLabel: string; speechTitle?: string; elapsed: string | null; preview?: RecordingJobPreview; previewLoading?: boolean;
  ensurePreview: (jobId: string) => Promise<void>; cancel: (jobId: string) => void; remove: (job: RecordingJobSummary) => void;
  exportResult: (jobId: string, type: 'transcript-txt' | 'translation-txt' | 'report-txt' | 'report-docx') => void;
  getTranscript: (jobId: string) => Promise<RecordingTranscriptResult>; getTranslation: (jobId: string) => Promise<RecordingTranslationResult>; getSummary: (jobId: string) => Promise<RecordingSummaryResult>;
  failureText: (error: { code: string; message: string; providerCode?: string } | undefined, language: string) => string;
}) {
  const [expanded, setExpanded] = useState(false); const [dialog, setDialog] = useState<ResultDialog>(null);
  const [transcript, setTranscript] = useState<RecordingTranscriptResult>(); const [translation, setTranslation] = useState<RecordingTranslationResult>(); const [summary, setSummary] = useState<RecordingSummaryResult>();
  const [resultError, setResultError] = useState<string | null>(null);
  const available = job.artifacts.some((artifact) => ['transcript-json', 'translation-json', 'summary-json'].includes(artifact.kind));
  useEffect(() => { if (expanded && !preview) void ensurePreview(job.jobId); }, [expanded, preview, job.jobId, ensurePreview]);
  const open = async (kind: Exclude<ResultDialog, null>) => {
    setResultError(null);
    try {
      if (kind === 'transcript') setTranscript(await getTranscript(job.jobId));
      if (kind === 'translation') setTranslation(await getTranslation(job.jobId));
      if (kind === 'summary') setSummary(await getSummary(job.jobId));
      setDialog(kind);
    } catch (error) { setResultError(error instanceof Error ? error.message : localized(language, '无法打开完整结果。', '完全な結果を開けません。', 'Unable to open the complete result.')); }
  };
  const stageError = (stage: string) => { const value = stageFor(job, stage); return value?.status === 'failed' ? value.error || failureText(job.error, language) : null; };
  const elapsedText = elapsed ? localized(language, `耗时 ${elapsed}`, `所要 ${elapsed}`, `Took ${elapsed}`) : '';
  const toggle = () => { if (available) setExpanded((value) => !value); };
  const view = (kind: Exclude<ResultDialog, null>, zh: string, ja: string, en: string) => <button type="button" onClick={(event) => { event.stopPropagation(); void open(kind); }}>{localized(language, zh, ja, en)}</button>;

  return <li className={`recording-job-card is-${job.status}${available ? ' is-expandable' : ''}${expanded ? ' is-expanded' : ''}`} onClick={toggle}><div className="recording-job-card__body">
    <div className="recording-job-card__title"><strong>{job.sourceFileName}</strong>{available && <button type="button" className="recording-job-fold-cue" aria-label={expanded ? localized(language, '收起结果', '結果を閉じる', 'Collapse results') : localized(language, '展开结果', '結果を展開', 'Expand results')} title={expanded ? localized(language, '收起结果', '結果を閉じる', 'Collapse results') : localized(language, '展开结果', '結果を展開', 'Expand results')} onClick={(event) => { event.stopPropagation(); toggle(); }}>{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>}</div><span title={speechTitle}>{[speechLabel, statusLabel(job.status, language), elapsedText].filter(Boolean).join(' · ')}</span>
    {job.status === 'failed' && <p className="recording-job-error" role="alert"><CircleAlert size={14} />{failureText(job.error, language)}</p>}
    <div className="recording-stage-progress">{job.stageRuns.filter((stage) => stage.stage !== 'report.build').map((stage) => <span key={stage.stage} className={`is-${stage.status}`} title={stage.error || `${stageLabel(stage.stage, language)}: ${stage.progress}%`}>{stageLabel(stage.stage, language)} {stage.status === 'running' ? `${stage.progress}%` : statusLabel(stage.status, language)}</span>)}</div>
    {expanded && <div className="recording-result-previews">
      {previewLoading && <p className="recording-hint">{localized(language, '正在加载结果…', '結果を読み込んでいます…', 'Loading results…')}</p>}
      {resultError && <p className="recording-job-error" role="alert"><CircleAlert size={14} />{resultError}</p>}
      {preview?.availability.transcript && <section><header><h3>{localized(language, '转写内容', '文字起こし', 'Transcript')}</h3>{view('transcript', '查看完整转写 ›', '完全な文字起こしを見る ›', 'View complete transcript ›')}</header><p className="recording-hint">{preview.transcript?.segmentCount} {localized(language, '段', 'セグメント', 'segments')} · {preview.transcript?.speakerCount} {localized(language, '位说话人', '人の話者', 'speakers')}</p>{preview.transcript?.segments.map((segment) => <p key={segment.id}><time>{new Date(segment.startMs).toISOString().slice(14, 23)}</time> {segment.speakerId && `[${segment.speakerId}] `}{segment.text}</p>)}</section>}
      {stageError('speech.execute') && !preview?.availability.transcript && <section className="recording-result-previews__failed"><h3>{localized(language, '转写内容', '文字起こし', 'Transcript')}</h3><p>[{statusLabel('failed', language)}] {stageError('speech.execute')}</p></section>}
      {preview?.availability.translation && <section><header><h3>{localized(language, '翻译结果', '翻訳結果', 'Translation')}</h3>{view('translation', '查看完整翻译 ›', '完全な翻訳を見る ›', 'View complete translation ›')}</header><p className="recording-hint">{localized(language, '自动识别', '自動認識', 'Detected')} → {getLanguageOption(preview.translation?.targetLanguage || 'zh').name}</p>{preview.translation?.texts.map((item, index) => <p key={index}>{item}</p>)}</section>}
      {stageError('translation.execute') && <section className="recording-result-previews__failed"><h3>{localized(language, '翻译结果', '翻訳結果', 'Translation')}</h3><p>[{statusLabel('failed', language)}] {stageError('translation.execute')}</p></section>}
      {preview?.availability.summary && <section><header><h3>{localized(language, '总结报告', '要約レポート', 'Summary report')}</h3>{view('summary', '查看完整报告 ›', '完全なレポートを見る ›', 'View complete report ›')}</header><h4>{preview.summary?.topic}</h4>{preview.summary?.conclusions.map((item) => <p key={item}>• {item}</p>)}{preview.summary?.actionItems.map((item) => <p key={item}>□ {item}</p>)}</section>}
      {stageError('summary.execute') && <section className="recording-result-previews__failed"><h3>{localized(language, '总结报告', '要約レポート', 'Summary report')}</h3><p>[{statusLabel('failed', language)}] {stageError('summary.execute')}</p></section>}
    </div>}
  </div><div className="recording-job-actions">
    {!terminal(job.status) && <button type="button" className="recording-cancel" onClick={(event) => { event.stopPropagation(); cancel(job.jobId); }} disabled={job.cancellationRequested}><Square size={14} />{localized(language, '取消', 'キャンセル', 'Cancel')}</button>}
    {terminal(job.status) && <button type="button" className="recording-delete" aria-label={`${localized(language, '删除任务', 'タスクを削除', 'Delete task')} ${job.sourceFileName}`} title={localized(language, '删除任务', 'タスクを削除', 'Delete task')} onClick={(event) => { event.stopPropagation(); remove(job); }}><Trash2 size={15} /></button>}
  </div>{dialog === 'transcript' && transcript && <TranscriptDialog jobId={job.jobId} result={transcript} onClose={() => setDialog(null)} onExport={(type) => exportResult(job.jobId, type)} />}{dialog === 'translation' && translation && <TranslationDialog jobId={job.jobId} result={translation} onClose={() => setDialog(null)} onExport={(type) => exportResult(job.jobId, type)} />}{dialog === 'summary' && summary && <SummaryReportDialog result={summary} onClose={() => setDialog(null)} onExport={(type) => exportResult(job.jobId, type)} />}</li>;
}
