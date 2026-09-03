const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const { existsSync } = require('fs');

const execFileAsync = promisify(execFile);
const MAX_POC_DURATION_SECONDS = 90 * 60;

function parseProbeOutput(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('ffprobe returned invalid metadata.');
  }
  const audioStream = parsed.streams?.find((stream) => stream.codec_type === 'audio');
  const durationSeconds = Number(parsed.format?.duration ?? audioStream?.duration);
  if (!audioStream || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('The selected file does not contain readable audio metadata.');
  }
  return {
    durationSeconds,
    codec: audioStream.codec_name || 'unknown',
    sampleRate: Number(audioStream.sample_rate) || null,
    channels: Number(audioStream.channels) || null,
    format: parsed.format?.format_name || path.extname(parsed.format?.filename || '').slice(1),
  };
}

function validatePocAudio(metadata) {
  if (metadata.durationSeconds > MAX_POC_DURATION_SECONDS) {
    throw new Error('Recordings can be up to 90 minutes long.');
  }
  return metadata;
}

function resolveFfprobeCommand({
  platform = process.platform,
  resourcesPath = process.resourcesPath,
  exists = existsSync,
} = {}) {
  // Forge copies the repository's `resources/` directory below Electron's
  // resources path. Windows does not include ffprobe in PATH, so packaged
  // builds must use the executable shipped with Sokuji.
  if (platform === 'win32' && resourcesPath) {
    const bundled = path.join(resourcesPath, 'resources', 'bin', 'win32-x64', 'ffprobe.exe');
    if (exists(bundled)) return bundled;
  }
  return 'ffprobe';
}

async function probeAudioFile(filePath, { command } = {}) {
  if (!path.isAbsolute(filePath)) throw new Error('Audio file path must be absolute.');
  const probeCommand = command || resolveFfprobeCommand();
  let stdout;
  try {
    ({ stdout } = await execFileAsync(probeCommand, [
      '-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,sample_rate,channels,duration',
      '-of', 'json', filePath,
    ], { maxBuffer: 1024 * 1024, windowsHide: true }));
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('ffprobe is required to inspect recording audio but was not found.');
    throw new Error('Unable to inspect the selected audio file.');
  }
  return validatePocAudio(parseProbeOutput(stdout));
}

module.exports = { MAX_POC_DURATION_SECONDS, parseProbeOutput, probeAudioFile, resolveFfprobeCommand, validatePocAudio };
