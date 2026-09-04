import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { RecordingTranscriptResult } from '../types/recording';
import { RecordingAudioPlayer } from './RecordingAudioPlayer';
import { RecordingResultDialog } from './RecordingResultDialog';
import { SpeakerFilter } from './SpeakerFilter';

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

export function TranscriptDialog({ jobId, result, onClose, onExport }: { jobId: string; result: RecordingTranscriptResult; onClose: () => void; onExport: (type: 'transcript-txt') => void }) {
  const [selected, setSelected] = useState<string[]>([]); const [appliedSearch, setAppliedSearch] = useState(''); const [seekMs, setSeekMs] = useState<number>();
  const speakers = useMemo(() => [...new Set(result.segments.map((segment) => segment.speakerId).filter(Boolean) as string[])], [result]);
  const shown = result.segments.filter((segment) => (!selected.length || selected.includes(segment.speakerId || '')) && segment.text.toLowerCase().includes(appliedSearch.toLowerCase()));
  const copyTranscript = async () => { await navigator.clipboard.writeText(transcriptLines(result)); };
  return <RecordingResultDialog title="完整转写" onClose={onClose}>
    <p className="recording-hint">共 {result.segments.length} 段 · {speakers.length} 位说话人</p>
    <div className="recording-result-dialog__tools">
      <SpeakerFilter speakers={speakers} selected={selected} onChange={setSelected} />
      <label className="recording-result-search"><Search size={16} aria-hidden="true" /><span className="sr-only">搜索内容</span><input defaultValue={appliedSearch} aria-label="搜索内容" placeholder="离开输入框后搜索" onBlur={(event) => setAppliedSearch(event.currentTarget.value.trim())} /></label>
    </div>
    <div className="recording-result-list">{shown.map((segment) => <button type="button" key={segment.id} onClick={() => setSeekMs(segment.startMs)}><time>{transcriptTimestamp(segment.startMs)}</time><b>{segment.speakerId ? `[${segment.speakerId}]` : ''}</b><span>{highlightMatch(segment.text, appliedSearch)}</span></button>)}</div>
    <RecordingAudioPlayer jobId={jobId} seekMs={seekMs} />
    <footer><button type="button" onClick={() => void copyTranscript()}>复制全文</button><button type="button" onClick={() => onExport('transcript-txt')}>下载 TXT</button></footer>
  </RecordingResultDialog>;
}
