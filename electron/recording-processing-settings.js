const { mkdir, readFile, rename, writeFile } = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { PROVIDER_IDS, STAGES, normalizeSelection } = require('./recording-provider-registry');
const { normalizeTemplateId } = require('./recording-summary-templates');

const SETTINGS_VERSION = 4;
const SPEECH_PROFILE_IDS = Object.freeze({ 'private-moss': 'speech.private-moss', 'private-funasr': 'speech.private-funasr', 'aliyun-cloud': 'speech.aliyun' });
const TEXT_PROFILE_IDS = Object.freeze({ translation: { 'private-runtime': 'translation.private', 'aliyun-cloud': 'translation.aliyun' }, summary: { 'private-runtime': 'summary.private', 'aliyun-cloud': 'summary.aliyun' } });

function settingsFile(app) { return path.join(app.getPath('userData'), 'recording-processing-settings.json'); }

function defaultProcessingSettings() {
  return {
    version: SETTINGS_VERSION,
    speech: normalizeSelection(STAGES.SPEECH, { providerId: PROVIDER_IDS.PRIVATE_RUNTIME, engineId: 'moss' }),
    sourceLanguageMode: 'auto', targetLanguage: 'zh', hotwords: [],
    translation: { enabled: false, ...normalizeSelection(STAGES.TRANSLATION, { providerId: PROVIDER_IDS.ALIYUN_CLOUD }) },
    summary: { enabled: false, ...normalizeSelection(STAGES.SUMMARY, { providerId: PROVIDER_IDS.ALIYUN_CLOUD }), templateId: 'general-meeting', inputMode: 'bilingual', reportLanguage: 'auto' },
  };
}

function legacySpeech(input) {
  const scheme = ['private-moss', 'private-funasr', 'aliyun-cloud'].includes(input.scheme) ? input.scheme : 'private-moss';
  if (input.speech && typeof input.speech === 'object') return normalizeSelection(STAGES.SPEECH, input.speech);
  if (scheme === 'aliyun-cloud') return normalizeSelection(STAGES.SPEECH, { providerId: PROVIDER_IDS.ALIYUN_CLOUD, connectionProfileId: input.speechProfileId || SPEECH_PROFILE_IDS[scheme] });
  return normalizeSelection(STAGES.SPEECH, { providerId: PROVIDER_IDS.PRIVATE_RUNTIME, engineId: scheme === 'private-funasr' ? 'funasr-meeting' : 'moss', connectionProfileId: input.speechProfileId || SPEECH_PROFILE_IDS[scheme] });
}

function normalizeTextStage(stage, input, defaults) {
  const legacy = input?.provider || input?.providerId;
  const providerId = legacy === PROVIDER_IDS.PRIVATE_RUNTIME ? PROVIDER_IDS.PRIVATE_RUNTIME : PROVIDER_IDS.ALIYUN_CLOUD;
  return {
    enabled: Boolean(input?.enabled),
    ...normalizeSelection(stage, { ...input, providerId }),
    ...(stage === STAGES.SUMMARY ? {
      templateId: normalizeTemplateId(input?.templateId || defaults.summary.templateId),
      inputMode: ['source', 'translated', 'bilingual'].includes(input?.inputMode) ? input.inputMode : defaults.summary.inputMode,
      reportLanguage: ['auto', 'zh', 'en', 'ja'].includes(input?.reportLanguage) ? input.reportLanguage : defaults.summary.reportLanguage,
    } : {}),
  };
}

function normalize(input = {}) {
  const defaults = defaultProcessingSettings();
  const sourceLanguageMode = ['auto', 'mixed', 'fixed'].includes(input.sourceLanguageMode) ? input.sourceLanguageMode : defaults.sourceLanguageMode;
  const translation = normalizeTextStage(STAGES.TRANSLATION, input.translation, defaults);
  const summary = normalizeTextStage(STAGES.SUMMARY, input.summary, defaults);
  return {
    version: SETTINGS_VERSION,
    speech: legacySpeech(input),
    sourceLanguageMode,
    ...(sourceLanguageMode === 'fixed' ? { sourceLanguage: ['zh', 'en', 'ja'].includes(input.sourceLanguage) ? input.sourceLanguage : 'zh' } : {}),
    targetLanguage: ['zh', 'en', 'ja'].includes(input.targetLanguage) ? input.targetLanguage : defaults.targetLanguage,
    hotwords: [...new Set((Array.isArray(input.hotwords) ? input.hotwords : []).map((word) => String(word).trim()).filter(Boolean))].slice(0, 200),
    translation,
    summary,
  };
}

function validate(settings) {
  if (settings.sourceLanguageMode === 'fixed' && !settings.sourceLanguage) throw new Error('A fixed source language is required.');
  if (!settings.speech?.providerId || !settings.speech?.connectionProfileId || !settings.speech?.engineId) throw new Error('Choose a transcription provider and connection.');
  // A private text Runtime may be configured before it publishes a text model.
  // Persist that selection and let the Registry return the precise capability
  // error at task start rather than forcing the UI to invent a model.
  if (settings.translation.enabled && settings.translation.providerId === PROVIDER_IDS.ALIYUN_CLOUD && !settings.translation.modelId) throw new Error('Choose a translation model.');
  if (settings.summary.enabled && settings.summary.providerId === PROVIDER_IDS.ALIYUN_CLOUD && !settings.summary.modelId) throw new Error('Choose a summary model.');
  if (settings.summary.enabled && ['translated', 'bilingual'].includes(settings.summary.inputMode) && !settings.translation.enabled) throw new Error('Translated or bilingual summary input requires translation.');
}

async function writeAtomic(file, value) { const temporary = `${file}.${crypto.randomUUID()}.tmp`; await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 }); await rename(temporary, file); }

class RecordingProcessingSettingsStore {
  constructor({ app }) { this.app = app; }
  async get() { try { return normalize(JSON.parse(await readFile(settingsFile(this.app), 'utf8'))); } catch (error) { if (error?.code === 'ENOENT') return defaultProcessingSettings(); throw error; } }
  async initialize() {
    try {
      const raw = JSON.parse(await readFile(settingsFile(this.app), 'utf8'));
      const settings = normalize(raw);
      const legacyProfileId = raw.profileId || null;
      const upgraded = raw.version !== SETTINGS_VERSION || legacyProfileId || !raw.speech;
      if (upgraded) await writeAtomic(settingsFile(this.app), settings);
      return { settings, created: false, upgraded, legacyProfileId };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const settings = defaultProcessingSettings();
      await mkdir(path.dirname(settingsFile(this.app)), { recursive: true, mode: 0o700 });
      await writeAtomic(settingsFile(this.app), settings);
      return { settings, created: true, upgraded: false, legacyProfileId: null };
    }
  }
  async save(input) { const value = normalize(input); validate(value); await mkdir(path.dirname(settingsFile(this.app)), { recursive: true, mode: 0o700 }); await writeAtomic(settingsFile(this.app), value); return value; }
}

module.exports = { RecordingProcessingSettingsStore, SETTINGS_VERSION, SPEECH_PROFILE_IDS, TEXT_PROFILE_IDS, defaultProcessingSettings, normalize, validate };
