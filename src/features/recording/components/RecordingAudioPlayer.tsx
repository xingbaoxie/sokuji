import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

export const recordingAudioUrl = (jobId: string) => `sokuji-recording://audio/${encodeURIComponent(jobId)}`;

export function RecordingAudioPlayer({ jobId, seekMs }: { jobId: string; seekMs?: number }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    if (seekMs === undefined || !audio.current) return;
    audio.current.currentTime = seekMs / 1000;
    void audio.current.play().catch(() => undefined);
  }, [seekMs]);
  const time = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  if (!available) return <p className="recording-hint">原音频文件已不可用。</p>;
  return <div className="recording-audio-player"><audio ref={audio} src={recordingAudioUrl(jobId)} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)} onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setAvailable(false)} /><button type="button" aria-label={playing ? '暂停' : '播放'} onClick={() => { const node = audio.current; if (!node) return; if (node.paused) void node.play().catch(() => undefined); else node.pause(); }}>{playing ? <Pause size={16} /> : <Play size={16} />}</button><span>{time(current)} / {time(duration)}</span><input aria-label="播放进度" type="range" min="0" max={duration || 0} value={Math.min(current, duration || 0)} step="0.1" onChange={(event) => { const value = Number(event.target.value); if (audio.current) audio.current.currentTime = value; setCurrent(value); }} /></div>;
}
