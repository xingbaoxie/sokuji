const OSS = require('ali-oss');

const MODELS = Object.freeze({ speech: 'qwen-audio-3.0-asr-flash-filetrans', translation: 'qwen-mt-plus', summary: 'qwen3.8-max' });
const MIXED_LANGUAGE_HINTS = ['zh', 'en', 'ja'];
const TRANSLATION_LANGUAGES = Object.freeze({ zh: 'Chinese', en: 'English', ja: 'Japanese' });

function bailianBaseUrl(workspaceId) { return `https://${workspaceId}.cn-beijing.maas.aliyuncs.com`; }
class BailianApiError extends Error {
  constructor({ message, code, requestId, status }) {
    super(message);
    this.name = 'BailianApiError';
    this.code = code || 'BAILIAN_API_ERROR';
    this.requestId = requestId || '';
    this.status = Number.isFinite(status) ? status : 0;
  }
}

function responseRequestId(response, body) {
  return body?.request_id || response.headers?.get?.('x-request-id') || response.headers?.get?.('x-dashscope-request-id') || '';
}

function isOssUrlResolutionFailure(error) {
  // Only an explicit pre-task Filetrans rejection is safe to retry. Network
  // failures may have created a task, so they must never be retried here.
  return error instanceof BailianApiError
    && /fetch failed|file.*(?:download|fetch)|(?:download|fetch).*file|oss.*(?:download|fetch)/i.test(`${error.code} ${error.message}`);
}
function objectKey(profile, jobId, fileName) { return `${profile.objectPrefix}/${jobId}/${Date.now()}-${String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_')}`; }
function buildSpeechParameters(config) {
  const parameters = { channel_id: [0], diarization_enabled: true };
  if (config.sourceLanguageMode === 'fixed' && config.sourceLanguage) parameters.language_hints = [config.sourceLanguage];
  if (config.sourceLanguageMode === 'mixed') parameters.language_hints = MIXED_LANGUAGE_HINTS;
  const words = (config.hotwords || []).map((word) => String(word).trim()).filter(Boolean).slice(0, 200);
  if (words.length) parameters.vocabulary = Object.fromEntries(words.map((word) => [word, 4]));
  return parameters;
}
function translationOptions(config) {
  const target_lang = TRANSLATION_LANGUAGES[config.targetLanguage] || config.targetLanguage;
  const source_lang = config.sourceLanguageMode === 'fixed' && config.sourceLanguage ? (TRANSLATION_LANGUAGES[config.sourceLanguage] || config.sourceLanguage) : undefined;
  return { target_lang, ...(source_lang ? { source_lang } : {}) };
}
function normalizeTranscript(payload) {
  const sentences = (payload.transcripts || []).flatMap((transcript) => transcript.sentences || []);
  return { segments: sentences.map((sentence, index) => ({ id: `seg-${String(index + 1).padStart(4, '0')}`, startMs: Number(sentence.begin_time) || 0, endMs: Number(sentence.end_time) || 0, ...(sentence.speaker_id !== undefined ? { speakerId: `S${String(Number(sentence.speaker_id) + 1).padStart(2, '0')}` } : {}), text: String(sentence.text || '') })) };
}
function markerBatch(segments) { return segments.map((item) => `<<<SEG:${item.id}>>>\n${item.text}\n<<<END_SEG>>>`).join('\n\n'); }
function parseMarkerBatch(raw, expectedIds) {
  const matches = [...String(raw || '').matchAll(/<<<SEG:([^>]+)>>>\s*([\s\S]*?)\s*<<<END_SEG>>>/g)];
  const values = new Map();
  for (const match of matches) { if (values.has(match[1]) || !expectedIds.includes(match[1])) throw new Error('Translation marker output has duplicate or unknown segment ids.'); values.set(match[1], match[2].trim()); }
  if (values.size !== expectedIds.length || expectedIds.some((id) => !values.has(id))) throw new Error('Translation marker output is missing segment ids.');
  return expectedIds.map((id) => ({ id, translatedText: values.get(id) }));
}
function parseSummary(raw, allowedIds) {
  const value = JSON.parse(String(raw).replace(/^```json\s*|\s*```$/g, '').trim());
  for (const collection of ['topics', 'decisions', 'actions', 'openQuestions', 'risks', 'facts']) for (const item of value[collection] || []) for (const id of item.sourceSegmentIds || []) if (!allowedIds.has(id)) throw new Error(`Summary references an unknown source segment: ${id}`);
  return value;
}

async function translateBatch(client, config, segments, strict = false) {
  const ids = segments.map((segment) => segment.id);
  const prompt = `${strict ? '必须严格原样返回每一个 SEG marker；' : ''}翻译为 ${config.targetLanguage}。不得合并、删除、重排或翻译 SEG marker。\n\n${markerBatch(segments)}`;
  const raw = await client.chat(config.translation?.modelId || MODELS.translation, [{ role: 'user', content: prompt }], { translation_options: translationOptions(config) });
  const translated = parseMarkerBatch(raw, ids);
  return segments.map((segment) => ({ ...segment, translatedText: translated.find((item) => item.id === segment.id).translatedText }));
}

async function translateSegments(client, config, segments) {
  const batches = []; let current = []; let chars = 0;
  for (const segment of segments) {
    const next = String(segment.text || '').length;
    if (current.length && (current.length >= 50 || chars + next > 12_000)) { batches.push(current); current = []; chars = 0; }
    current.push(segment); chars += next;
  }
  if (current.length) batches.push(current);
  const result = [];
  for (const batch of batches) {
    try { result.push(...await translateBatch(client, config, batch)); continue; } catch {}
    try { result.push(...await translateBatch(client, config, batch, true)); continue; } catch {}
    if (batch.length === 1) result.push(...await translateBatch(client, config, batch, true));
    else {
      const half = Math.ceil(batch.length / 2);
      result.push(...await translateSegments(client, config, batch.slice(0, half)));
      result.push(...await translateSegments(client, config, batch.slice(half)));
    }
  }
  return { segments: result };
}

async function summarizeOnce(client, config, segments) {
  const allowedIds = new Set(segments.map((segment) => segment.id));
  const source = config.summary.inputMode === 'translated'
    ? segments.map((segment) => ({ ...segment, text: segment.translatedText || '' }))
    : segments;
  const content = JSON.stringify(source.map(({ id, speakerId, startMs, endMs, text, translatedText }) => ({ id, speakerId, startMs, endMs, text, ...(config.summary.inputMode === 'bilingual' ? { translatedText } : {}) })));
  const prompt = `请根据以下录音片段生成 JSON：summary、topics、decisions、actions、openQuestions、risks、facts。每个数组项必须含 text 与 sourceSegmentIds，且来源只能使用输入 ID。只返回 JSON。\n${content}`;
  const model = config.summary?.modelId || MODELS.summary;
  let raw = await client.chat(model, [{ role: 'user', content: prompt }]);
  try { return parseSummary(raw, allowedIds); } catch {
    raw = await client.chat(model, [{ role: 'user', content: `${prompt}\n上次输出无效。只返回合法 JSON，且不得引用未知 ID。` }]);
    return parseSummary(raw, allowedIds);
  }
}

async function summarizeSegments(client, config, segments) {
  return summarizeOnce(client, config, segments);
}

class AliyunOssClient {
  constructor(profile, client = null) { this.profile = profile; this.client = client || new OSS({ region: 'oss-cn-beijing', endpoint: profile.ossEndpoint, accessKeyId: profile.ossAccessKeyId, accessKeySecret: profile.ossAccessKeySecret, bucket: profile.ossBucket }); }
  upload(key, sourcePath, { onUploadProgress } = {}) {
    return this.client.multipartUpload(key, sourcePath, {
      progress: (percentage) => onUploadProgress?.(Math.min(99, Math.floor(Number(percentage) * 100))),
    });
  }
  signedGetUrl(key, expiresSeconds = 24 * 60 * 60) { return this.client.signatureUrl(key, { expires: expiresSeconds, method: 'GET' }); }
  remove(key) { return this.client.delete(key); }
}

class BailianClient {
  constructor(profile, { fetchImpl = global.fetch } = {}) { this.profile = profile; this.fetch = fetchImpl; this.baseUrl = profile.apiBaseUrl || bailianBaseUrl(profile.workspaceId); }
  async request(path, options = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, { ...options, headers: { Authorization: `Bearer ${this.profile.dashscopeApiKey}`, Accept: 'application/json', ...(options.headers || {}) } });
    const text = await response.text(); let body;
    try { body = text ? JSON.parse(text) : {}; }
    catch { throw new BailianApiError({ message: 'Bailian returned invalid JSON.', code: 'BAILIAN_INVALID_RESPONSE', requestId: responseRequestId(response, null), status: response.status }); }
    if (!response.ok) throw new BailianApiError({ message: body?.message || `Bailian returned HTTP ${response.status}.`, code: body?.code, requestId: responseRequestId(response, body), status: response.status });
    return body;
  }
  async submitFiletrans(fileUrl, config) {
    const submit = async (resolveOssResource = false) => this.request('/api/v1/services/audio/asr/transcription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable', ...(resolveOssResource ? { 'X-DashScope-OssResourceResolve': 'enable' } : {}) },
      body: JSON.stringify({ model: config?.speech?.modelId || this.profile.modelId || MODELS.speech, input: { file_urls: [fileUrl] }, parameters: buildSpeechParameters(config) }),
    });
    let body;
    try { body = await submit(); }
    catch (error) {
      if (!isOssUrlResolutionFailure(error)) throw error;
      body = await submit(true);
    }
    return { externalTaskId: body.output?.task_id, requestId: body.request_id };
  }
  getTask(taskId) { return this.request(`/api/v1/tasks/${encodeURIComponent(taskId)}`); }
  cancelTask(taskId) { return this.request(`/api/v1/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' }); }
  async downloadTranscript(url) { const response = await this.fetch(url); if (!response.ok) throw new Error(`Unable to download Filetrans result: HTTP ${response.status}.`); return response.json(); }
  async chat(model, messages, extra = {}) { const body = await this.request('/compatible-mode/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, stream: false, ...extra }) }); return String(body.choices?.[0]?.message?.content || ''); }
}

module.exports = { AliyunOssClient, BailianApiError, BailianClient, MIXED_LANGUAGE_HINTS, MODELS, TRANSLATION_LANGUAGES, bailianBaseUrl, buildSpeechParameters, markerBatch, normalizeTranscript, objectKey, parseMarkerBatch, parseSummary, summarizeSegments, translateSegments, translationOptions };
