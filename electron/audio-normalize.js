const { execFile } = require('child_process');
const { mkdir } = require('fs/promises');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function buildCloudMonoAacArgs(sourcePath, destinationPath) {
  return ['-y', '-i', sourcePath, '-vn', '-ac', '1', '-c:a', 'aac', '-b:a', '96k', destinationPath];
}

async function normalizeForCloudSpeech(sourcePath, outputDirectory, { command = 'ffmpeg' } = {}) {
  if (!path.isAbsolute(sourcePath) || !path.isAbsolute(outputDirectory)) throw new Error('Audio normalization paths must be absolute.');
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const destinationPath = path.join(outputDirectory, `${path.basename(sourcePath, path.extname(sourcePath))}-cloud-mono.m4a`);
  try {
    await execFileAsync(command, buildCloudMonoAacArgs(sourcePath, destinationPath), { maxBuffer: 1024 * 1024, windowsHide: true });
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('ffmpeg is required to normalize audio for cloud speech but was not found.');
    throw new Error('Unable to normalize recording audio for cloud speech.');
  }
  return destinationPath;
}

module.exports = { buildCloudMonoAacArgs, normalizeForCloudSpeech };
