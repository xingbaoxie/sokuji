const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

function validateRuntimeConnection(baseUrl, token) {
  const parsed = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !token) {
    throw new Error('A credentialed http or https Runtime profile is required.');
  }
  return parsed;
}

function privateSpeechEngine(config) {
  if (config?.speech?.providerId === 'private-runtime' && ['moss', 'funasr-meeting'].includes(config.speech.engineId)) return config.speech.engineId;
  // Compatibility for a task that was already written before the schema upgrade.
  if (config?.scheme === 'private-moss') return 'moss';
  if (config?.scheme === 'private-funasr') return 'funasr-meeting';
  throw new Error('A private Runtime speech selection is required.');
}

class RecordingRuntimeError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.name = 'RecordingRuntimeError';
    if (code) this.code = code;
    if (status) this.status = status;
  }
}

class RecordingRuntimeClient {
  constructor({ baseUrl, token, request = null }) {
    this.url = validateRuntimeConnection(baseUrl, token);
    this.token = token;
    this.request = request;
  }

  async health() { return this.json('GET', '/v1/health'); }
  async capabilities() { return this.json('GET', '/v1/capabilities'); }
  async getTask(taskId) { return this.json('GET', `/v1/tasks/${encodeURIComponent(taskId)}`); }
  async getResult(taskId) { return this.json('GET', `/v1/tasks/${encodeURIComponent(taskId)}/result`); }
  async cancel(taskId) { return this.json('POST', `/v1/tasks/${encodeURIComponent(taskId)}/cancel`); }
  async submit(type, payload) {
    if (!['translation', 'summary'].includes(type)) throw new Error('Speech tasks must use submitSpeech().');
    const { profileRevision, modelId, ...stagePayload } = payload;
    return this.json('POST', `/v1/${type}/tasks`, { profileRevision, ...(modelId ? { modelId } : {}), payload: stagePayload });
  }

  async submitSpeech(audioPath, profileRevision, config, { onUploadProgress } = {}) {
    const source = await fs.promises.stat(audioPath);
    const boundary = `----sokuji-${Date.now().toString(16)}`;
    const fileName = path.basename(audioPath).replace(/"/g, '_');
    const fields = [
      ['profileRevision', profileRevision], ['engine', privateSpeechEngine(config)],
      ['sourceLanguageMode', config?.sourceLanguageMode || 'auto'],
      ['hotwords', JSON.stringify([...new Set((config?.hotwords || []).map((word) => String(word).trim()).filter(Boolean))])],
    ];
    if (config?.sourceLanguageMode === 'fixed' && config?.sourceLanguage) fields.push(['sourceLanguage', config.sourceLanguage]);
    const formFields = fields.map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`).join('');
    const prefix = Buffer.from(`${formFields}--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    return new Promise((resolve, reject) => {
      const transport = this.url.protocol === 'https:' ? https : http;
      const request = transport.request({
        protocol: this.url.protocol,
        hostname: this.url.hostname,
        port: this.url.port || undefined,
        path: `${this.url.pathname.replace(/\/$/, '')}/v1/speech/tasks`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': prefix.length + source.size + suffix.length,
        },
      }, (response) => this.collect(response, resolve, reject));
      request.on('error', (error) => reject(new Error(`Runtime speech upload failed: ${error.message}`)));
      request.write(prefix);
      const input = fs.createReadStream(audioPath);
      let uploadedBytes = 0;
      let lastProgress = -1;
      const reportProgress = () => {
        if (!onUploadProgress || source.size <= 0) return;
        // Keep 100% for the point at which the Runtime has accepted the
        // complete multipart request, rather than merely read it locally.
        const progress = Math.min(99, Math.floor((uploadedBytes / source.size) * 100));
        if (progress > lastProgress) {
          lastProgress = progress;
          onUploadProgress(progress);
        }
      };
      input.on('error', (error) => request.destroy(error));
      input.on('data', (chunk) => {
        uploadedBytes += chunk.length;
        reportProgress();
      });
      input.on('end', () => request.end(suffix));
      input.pipe(request, { end: false });
    });
  }

  json(method, requestPath, body) {
    const encoded = body === undefined ? null : Buffer.from(JSON.stringify(body));
    if (this.request) return this.request({ method, requestPath, body, token: this.token });
    return new Promise((resolve, reject) => {
      const transport = this.url.protocol === 'https:' ? https : http;
      const request = transport.request({
        protocol: this.url.protocol, hostname: this.url.hostname, port: this.url.port || undefined,
        path: `${this.url.pathname.replace(/\/$/, '')}${requestPath}`, method,
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': encoded.length } : {}) },
      }, (response) => this.collect(response, resolve, reject));
      request.on('error', (error) => reject(new Error(`Runtime request failed: ${error.message}`)));
      request.end(encoded || undefined);
    });
  }

  collect(response, resolve, reject) {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('error', reject);
    response.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (response.statusCode >= 400) {
        let payload;
        try { payload = JSON.parse(text); } catch { /* use a generic public message */ }
        const detail = payload?.detail;
        const message = typeof detail === 'string' ? detail : typeof detail?.message === 'string' ? detail.message : 'Runtime request failed.';
        const code = typeof detail?.code === 'string' ? detail.code : undefined;
        return reject(new RecordingRuntimeError(message, { code, status: response.statusCode }));
      }
      try { resolve(JSON.parse(text)); } catch { reject(new Error('Runtime returned invalid JSON.')); }
    });
  }
}

module.exports = { RecordingRuntimeClient, RecordingRuntimeError, privateSpeechEngine, validateRuntimeConnection };
