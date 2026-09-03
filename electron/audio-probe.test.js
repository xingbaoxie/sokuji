const { MAX_POC_DURATION_SECONDS, parseProbeOutput, resolveFfprobeCommand, validatePocAudio } = require('./audio-probe');
const path = require('path');

describe('audio probe', () => {
  it('extracts readable audio metadata', () => {
    expect(parseProbeOutput(JSON.stringify({
      format: { duration: '12.5', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
      streams: [{ codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 }],
    }))).toEqual({ durationSeconds: 12.5, codec: 'aac', sampleRate: 48000, channels: 2, format: 'mov,mp4,m4a,3gp,3g2,mj2' });
  });

  it('rejects a POC recording longer than 90 minutes', () => {
    expect(() => validatePocAudio({ durationSeconds: MAX_POC_DURATION_SECONDS + 1 })).toThrow('up to 90 minutes');
  });

  it('uses the bundled ffprobe executable in packaged Windows builds', () => {
    expect(resolveFfprobeCommand({
      platform: 'win32',
      resourcesPath: 'C:\\Sokuji\\resources',
      exists: () => true,
    })).toBe(path.join('C:\\Sokuji\\resources', 'resources', 'bin', 'win32-x64', 'ffprobe.exe'));
  });

  it('uses PATH ffprobe when no bundled executable is available', () => {
    expect(resolveFfprobeCommand({ platform: 'win32', resourcesPath: 'C:\\Sokuji\\resources', exists: () => false })).toBe('ffprobe');
  });
});
