import React from 'react';

const localized = (language: string, zh: string, ja: string, en: string) => language.startsWith('zh') ? zh : language.startsWith('ja') ? ja : en;

export function SpeakerFilter({ speakers, selected, onChange, language = 'zh' }: { speakers: string[]; selected: string[]; onChange: (value: string[]) => void; language?: string }) {
  const toggle = (speaker: string) => onChange(selected.includes(speaker) ? selected.filter((item) => item !== speaker) : [...selected, speaker]);
  const speaker = localized(language, '说话人', '話者', 'Speaker');
  const all = localized(language, '全部', 'すべて', 'All');
  return <div className="recording-speaker-filter" role="group" aria-label={localized(language, '按说话人筛选', '話者で絞り込み', 'Filter by speaker')}>
    <span>{speaker}</span>
    <div className="recording-speaker-filter__choices">
      <button type="button" className={!selected.length ? 'is-selected' : ''} aria-pressed={!selected.length} onClick={() => onChange([])}>{all}</button>
      {speakers.map((speaker) => <button type="button" key={speaker} className={selected.includes(speaker) ? 'is-selected' : ''} aria-pressed={selected.includes(speaker)} onClick={() => toggle(speaker)}>{speaker}</button>)}
    </div>
  </div>;
}
