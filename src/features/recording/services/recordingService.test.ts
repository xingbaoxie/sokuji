import { beforeEach, describe, expect, it } from 'vitest';
import { isSupportedRecordingAudioFile, recordingService } from './recordingService';

beforeEach(() => {
  (window as unknown as { electron: { getPathForFile: (file: File) => string } }).electron = {
    getPathForFile: () => '/tmp/meeting.MP3',
  };
});

describe('recording audio file admission', () => {
  it('uses only the fixed suffix allowlist, without inspecting media bytes', () => {
    expect(isSupportedRecordingAudioFile('meeting.MP3')).toBe(true);
    expect(isSupportedRecordingAudioFile('recording.flac')).toBe(true);
    expect(isSupportedRecordingAudioFile('recording.ogg')).toBe(false);
    expect(isSupportedRecordingAudioFile('recording.mp3.exe')).toBe(false);
  });

  it('accepts a dropped allowlisted file through the narrow preload path bridge', () => {
    const result = recordingService.droppedAudioFile({ name: 'meeting.MP3' } as File);
    expect(result).toEqual({ path: '/tmp/meeting.MP3', name: 'meeting.MP3', extension: '.mp3' });
    expect(recordingService.droppedAudioFile({ name: 'meeting.ogg' } as File)).toBeNull();
  });
});
