const { open, stat } = require('fs/promises');
const path = require('path');

const MIME_TYPES = Object.freeze({ '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac' });
const SAFE_JOB_ID = /^[a-zA-Z0-9_-]+$/;

function jobPath(app, jobId) { return path.join(app.getPath('userData'), 'recording-jobs', jobId, 'job.json'); }
function contentRange(range, size) {
  if (!range) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
  if (!match) return null;
  let start = match[1] === '' ? undefined : Number(match[1]); let end = match[2] === '' ? undefined : Number(match[2]);
  if (start === undefined && end === undefined) return null;
  if (start === undefined) { start = Math.max(0, size - end); end = size - 1; }
  else if (end === undefined || end >= size) end = size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) return null;
  return { start, end, partial: true };
}

async function readAudioResponse(app, request) {
  const url = new URL(request.url); const jobId = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!SAFE_JOB_ID.test(jobId)) return new Response(null, { status: 404 });
  let job;
  try { job = JSON.parse(await require('fs/promises').readFile(jobPath(app, jobId), 'utf8')); } catch { return new Response(null, { status: 404 }); }
  if (!job.sourcePath) return new Response(null, { status: 404 });
  let metadata;
  try { metadata = await stat(job.sourcePath); } catch { return new Response(null, { status: 404 }); }
  const range = contentRange(request.headers.get('range'), metadata.size);
  if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${metadata.size}` } });
  const handle = await open(job.sourcePath, 'r');
  try {
    const length = range.end - range.start + 1; const bytes = Buffer.alloc(length);
    await handle.read(bytes, 0, length, range.start);
    return new Response(bytes, { status: range.partial ? 206 : 200, headers: {
      'Content-Type': MIME_TYPES[path.extname(job.sourcePath).toLowerCase()] || 'application/octet-stream',
      'Accept-Ranges': 'bytes', 'Content-Length': String(length), ...(range.partial ? { 'Content-Range': `bytes ${range.start}-${range.end}/${metadata.size}` } : {}),
    } });
  } finally { await handle.close(); }
}

function registerRecordingAudioProtocol({ protocol, app }) {
  protocol.handle('sokuji-recording', (request) => readAudioResponse(app, request));
}

module.exports = { contentRange, readAudioResponse, registerRecordingAudioProtocol };
