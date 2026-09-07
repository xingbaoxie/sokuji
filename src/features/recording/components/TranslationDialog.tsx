import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { getLanguageOption } from '../../../utils/languages';
import type { RecordingTranslationResult } from '../types/recording';
import { RecordingAudioPlayer } from './RecordingAudioPlayer';
import { RecordingResultDialog } from './RecordingResultDialog';
import { SpeakerFilter } from './SpeakerFilter';

const localized = (language: string, zh: string, ja: string, en: string) => language.startsWith('zh') ? zh : language.startsWith('ja') ? ja : en;

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

function translationLines(segments: Array<{ startMs: number; speakerId?: string; text: string; translatedText: string }>, language: string) {
  return segments.map((segment) => {
    const prefix = `[${translationTimestamp(segment.startMs)}]${segment.speakerId ? ` [${segment.speakerId}]` : ''} `;
    return `${prefix}${localized(language, '原文：', '原文：', 'Original: ')}${segment.text}\n${' '.repeat(prefix.length)}${localized(language, '译文：', '訳文：', 'Translation: ')}${segment.translatedText}`;
  }).join('\n\n');
}

export function TranslationDialog({ jobId, result, onClose, onExport, language = 'zh' }: {
  jobId: string; result: RecordingTranslationResult; onClose: () => void; onExport: (type: 'translation-txt') => void; language?: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [appliedSearch, setAppliedSearch] = useState('');
  const [seekMs, setSeekMs] = useState<number>();
  const segments = result.segments;
  const speakers = useMemo(() => [...new Set(segments.map((segment) => segment.speakerId).filter(Boolean) as string[])], [segments]);
  const shown = segments.filter((segment) => (!selected.length || selected.includes(segment.speakerId || '')) && `${segment.text} ${segment.translatedText}`.toLowerCase().includes(appliedSearch.toLowerCase()));
  const copyTranslation = async () => {
    await navigator.clipboard.writeText(translationLines(segments, language));
  };
  const searchLabel = localized(language, '搜索内容', '内容を検索', 'Search content');
  const originalLabel = localized(language, '原文：', '原文：', 'Original:'); const translatedLabel = localized(language, '译文：', '訳文：', 'Translation:');
  return <RecordingResultDialog title={localized(language, '翻译结果', '翻訳結果', 'Translation result')} closeLabel={localized(language, '关闭', '閉じる', 'Close')} onClose={onClose}>
    <p className="recording-hint">{localized(language, '自动识别', '自動認識', 'Detected')} → {getLanguageOption(result.targetLanguage).name} · {localized(language, `共 ${segments.length} 段`, `${segments.length} セグメント`, `${segments.length} segments`)}</p>
    <div className="recording-result-dialog__tools"><SpeakerFilter speakers={speakers} selected={selected} onChange={setSelected} language={language} /><label className="recording-result-search"><Search size={16} aria-hidden="true" /><span className="sr-only">{searchLabel}</span><input defaultValue={appliedSearch} aria-label={searchLabel} placeholder={localized(language, '离开输入框后搜索', '入力欄を離れると検索', 'Search when leaving the field')} onBlur={(event) => setAppliedSearch(event.currentTarget.value.trim())} /></label></div>
    <div className="recording-result-list recording-translation-list">{shown.map((segment) => <button type="button" key={segment.id} onClick={() => setSeekMs(segment.startMs)}><time>{translationTimestamp(segment.startMs)}</time><b>{segment.speakerId ? `[${segment.speakerId}]` : ''}</b><span className="recording-translation-line"><strong>{originalLabel}</strong><span>{highlightMatch(segment.text, appliedSearch)}</span></span><span className="recording-translation-line"><strong>{translatedLabel}</strong><span>{highlightMatch(segment.translatedText, appliedSearch)}</span></span></button>)}</div>
    <RecordingAudioPlayer jobId={jobId} seekMs={seekMs} />
    <footer><button type="button" onClick={() => void copyTranslation()}>{localized(language, '复制全部译文', '翻訳全文をコピー', 'Copy all translations')}</button><button type="button" onClick={() => onExport('translation-txt')}>{localized(language, '下载 TXT', 'TXT をダウンロード', 'Download TXT')}</button></footer>
  </RecordingResultDialog>;
}
