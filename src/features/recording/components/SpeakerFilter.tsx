import React from 'react';

export function SpeakerFilter({ speakers, selected, onChange }: { speakers: string[]; selected: string[]; onChange: (value: string[]) => void }) {
  const toggle = (speaker: string) => onChange(selected.includes(speaker) ? selected.filter((item) => item !== speaker) : [...selected, speaker]);
  return <div className="recording-speaker-filter" role="group" aria-label="按说话人筛选">
    <span>说话人</span>
    <div className="recording-speaker-filter__choices">
      <button type="button" className={!selected.length ? 'is-selected' : ''} aria-pressed={!selected.length} onClick={() => onChange([])}>全部</button>
      {speakers.map((speaker) => <button type="button" key={speaker} className={selected.includes(speaker) ? 'is-selected' : ''} aria-pressed={selected.includes(speaker)} onClick={() => toggle(speaker)}>{speaker}</button>)}
    </div>
  </div>;
}
