import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { RecordingTranscriptResult } from '../types/recording';
import { RecordingAudioPlayer } from './RecordingAudioPlayer';
import { RecordingResultDialog } from './RecordingResultDialog';
import { SpeakerFilter } from './SpeakerFilter';

const localized = (language: string, zh: string, ja: string, en: string) => language.startsWith('zh') ? zh : language.startsWith('ja') ? ja : en;

function transcriptTimestamp(milliseconds: number) {
  const value = Math.max(0, Math.floor(milliseconds || 0));
  const hours = Math.floor(value / 3600000);
  const minutes = Math.floor(value % 3600000 / 60000);
  const seconds = Math.floor(value % 60000 / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`;
}

function transcriptLines(result: RecordingTranscriptResult) {
  return result.segments.map((segment) => `[${transcriptTimestamp(segment.startMs)}]${segment.speakerId ? ` [${segment.speakerId}]` : ''} ${segment.text}`).join('\n');
}

function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`(${escaped})`, 'gi');
  const normalizedQuery = query.toLowerCase();
  return text.split(matcher).map((part, index) => part.toLowerCase() === normalizedQuery ? <mark key={`${part}-${index}`}>{part}</mark> : part);
}

export function TranscriptDialog({ jobId, result, onClose, onExport, language = 'zh' }: { jobId: string; result: RecordingTranscriptResult; onClose: () => void; onExport: (type: 'transcript-txt') => void; language?: string }) {
  const [selected, setSelected] = useState<string[]>([]); const [appliedSearch, setAppliedSearch] = useState(''); const [seekMs, setSeekMs] = useState<number>();
  const speakers = useMemo(() => [...new Set(result.segments.map((segment) => segment.speakerId).filter(Boolean) as string[])], [result]);
  const shown = result.segments.filter((segment) => (!selected.length || selected.includes(segment.speakerId || '')) && segment.text.toLowerCase().includes(appliedSearch.toLowerCase()));
  const copyTranscript = async () => { await navigator.clipboard.writeText(transcriptLines(result)); };
  const searchLabel = localized(language, '搜索内容', '内容を検索', 'Search content');
  return <RecordingResultDialog title={localized(language, '完整转写', '完全な文字起こし', 'Complete transcript')} closeLabel={localized(language, '关闭', '閉じる', 'Close')} onClose={onClose}>
    <p className="recording-hint">{localized(language, `共 ${result.segments.length} 段 · ${speakers.length} 位说话人`, `${result.segments.length} セグメント・${speakers.length} 人の話者`, `${result.segments.length} segments · ${speakers.length} speakers`)}</p>
    <div className="recording-result-dialog__tools">
      <SpeakerFilter speakers={speakers} selected={selected} onChange={setSelected} language={language} />
      <label className="recording-result-search"><Search size={16} aria-hidden="true" /><span className="sr-only">{searchLabel}</span><input defaultValue={appliedSearch} aria-label={searchLabel} placeholder={localized(language, '离开输入框后搜索', '入力欄を離れると検索', 'Search when leaving the field')} onBlur={(event) => setAppliedSearch(event.currentTarget.value.trim())} /></label>
    </div>
    <div className="recording-result-list">{shown.map((segment) => <button type="button" key={segment.id} onClick={() => setSeekMs(segment.startMs)}><time>{transcriptTimestamp(segment.startMs)}</time><b>{segment.speakerId ? `[${segment.speakerId}]` : ''}</b><span>{highlightMatch(segment.text, appliedSearch)}</span></button>)}</div>
    <RecordingAudioPlayer jobId={jobId} seekMs={seekMs} />
    <footer><button type="button" onClick={() => void copyTranscript()}>{localized(language, '复制全文', '全文をコピー', 'Copy all')}</button><button type="button" onClick={() => onExport('transcript-txt')}>{localized(language, '下载 TXT', 'TXT をダウンロード', 'Download TXT')}</button></footer>
  </RecordingResultDialog>;
}
