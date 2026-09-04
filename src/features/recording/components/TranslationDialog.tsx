import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { getLanguageOption } from '../../../utils/languages';
import type { RecordingTranslationResult } from '../types/recording';
import { RecordingAudioPlayer } from './RecordingAudioPlayer';
import { RecordingResultDialog } from './RecordingResultDialog';
import { SpeakerFilter } from './SpeakerFilter';

function translationTimestamp(milliseconds: number) {
  const value = Math.max(0, Math.floor(milliseconds || 0));
  const hours = Math.floor(value / 3600000);
  const minutes = Math.floor(value % 3600000 / 60000);
  const seconds = Math.floor(value % 60000 / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`;
}

function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`(${escaped})`, 'gi');
  const normalizedQuery = query.toLowerCase();
  return text.split(matcher).map((part, index) => part.toLowerCase() === normalizedQuery ? <mark key={`${part}-${index}`}>{part}</mark> : part);
}

function translationLines(segments: Array<{ startMs: number; speakerId?: string; text: string; translatedText: string }>) {
  return segments.map((segment) => {
    const prefix = `[${translationTimestamp(segment.startMs)}]${segment.speakerId ? ` [${segment.speakerId}]` : ''} `;
    return `${prefix}原文：${segment.text}\n${' '.repeat(prefix.length)}译文：${segment.translatedText}`;
  }).join('\n\n');
}

export function TranslationDialog({ jobId, result, onClose, onExport }: {
  jobId: string; result: RecordingTranslationResult; onClose: () => void; onExport: (type: 'translation-txt') => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [appliedSearch, setAppliedSearch] = useState('');
  const [seekMs, setSeekMs] = useState<number>();
  const segments = result.segments;
  const speakers = useMemo(() => [...new Set(segments.map((segment) => segment.speakerId).filter(Boolean) as string[])], [segments]);
  const shown = segments.filter((segment) => (!selected.length || selected.includes(segment.speakerId || '')) && `${segment.text} ${segment.translatedText}`.toLowerCase().includes(appliedSearch.toLowerCase()));
  const copyTranslation = async () => {
    await navigator.clipboard.writeText(translationLines(segments));
  };
  return <RecordingResultDialog title="翻译结果" onClose={onClose}>
    <p className="recording-hint">自动识别 → {getLanguageOption(result.targetLanguage).name} · 共 {segments.length} 段</p>
    <div className="recording-result-dialog__tools"><SpeakerFilter speakers={speakers} selected={selected} onChange={setSelected} /><label className="recording-result-search"><Search size={16} aria-hidden="true" /><span className="sr-only">搜索内容</span><input defaultValue={appliedSearch} aria-label="搜索内容" placeholder="离开输入框后搜索" onBlur={(event) => setAppliedSearch(event.currentTarget.value.trim())} /></label></div>
    <div className="recording-result-list recording-translation-list">{shown.map((segment) => <button type="button" key={segment.id} onClick={() => setSeekMs(segment.startMs)}><time>{translationTimestamp(segment.startMs)}</time><b>{segment.speakerId ? `[${segment.speakerId}]` : ''}</b><span className="recording-translation-line"><strong>原文：</strong><span>{highlightMatch(segment.text, appliedSearch)}</span></span><span className="recording-translation-line"><strong>译文：</strong><span>{highlightMatch(segment.translatedText, appliedSearch)}</span></span></button>)}</div>
    <RecordingAudioPlayer jobId={jobId} seekMs={seekMs} />
    <footer><button type="button" onClick={() => void copyTranslation()}>复制全部译文</button><button type="button" onClick={() => onExport('translation-txt')}>下载 TXT</button></footer>
  </RecordingResultDialog>;
}
