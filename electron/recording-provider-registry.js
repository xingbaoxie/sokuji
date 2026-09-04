const { RecordingRuntimeClient } = require('./recording-runtime-client');

const PROVIDER_IDS = Object.freeze({ PRIVATE_RUNTIME: 'private-runtime', ALIYUN_CLOUD: 'aliyun-cloud' });
const STAGES = Object.freeze({ SPEECH: 'speech', TRANSLATION: 'translation', SUMMARY: 'summary' });

const CONNECTIONS = Object.freeze({
  'speech.private-moss': { id: 'speech.private-moss', providerId: PROVIDER_IDS.PRIVATE_RUNTIME, stage: STAGES.SPEECH, labelKey: 'mossRuntime' },
  'speech.private-funasr': { id: 'speech.private-funasr', providerId: PROVIDER_IDS.PRIVATE_RUNTIME, stage: STAGES.SPEECH, labelKey: 'funasrRuntime' },
  'speech.aliyun': { id: 'speech.aliyun', providerId: PROVIDER_IDS.ALIYUN_CLOUD, stage: STAGES.SPEECH, labelKey: 'aliyunSpeech' },
  'translation.private': { id: 'translation.private', providerId: PROVIDER_IDS.PRIVATE_RUNTIME, stage: STAGES.TRANSLATION, labelKey: 'privateTranslation' },
  'translation.aliyun': { id: 'translation.aliyun', providerId: PROVIDER_IDS.ALIYUN_CLOUD, stage: STAGES.TRANSLATION, labelKey: 'aliyunTranslation' },
  'summary.private': { id: 'summary.private', providerId: PROVIDER_IDS.PRIVATE_RUNTIME, stage: STAGES.SUMMARY, labelKey: 'privateSummary' },
  'summary.aliyun': { id: 'summary.aliyun', providerId: PROVIDER_IDS.ALIYUN_CLOUD, stage: STAGES.SUMMARY, labelKey: 'aliyunSummary' },
});

const SPEECH_OPTIONS = Object.freeze({
  moss: { engineId: 'moss', connectionProfileId: 'speech.private-moss', labelKey: 'moss', descriptionKey: 'mossDescription' },
  'funasr-meeting': { engineId: 'funasr-meeting', connectionProfileId: 'speech.private-funasr', labelKey: 'funasrMeeting', descriptionKey: 'funasrMeetingDescription' },
  'aliyun-filetrans': { engineId: 'aliyun-filetrans', connectionProfileId: 'speech.aliyun', modelId: 'qwen-audio-3.0-asr-flash-filetrans', labelKey: 'filetrans', descriptionKey: 'filetransDescription' },
});

function isProviderId(value) { return Object.values(PROVIDER_IDS).includes(value); }
function isStage(value) { return Object.values(STAGES).includes(value); }
function isPrivateEngine(value) { return value === 'moss' || value === 'funasr-meeting'; }
function connection(profileId) { return CONNECTIONS[profileId] || null; }

function defaultSelection(stage, providerId = PROVIDER_IDS.PRIVATE_RUNTIME) {
  if (stage === STAGES.SPEECH) {
    if (providerId === PROVIDER_IDS.ALIYUN_CLOUD) return { providerId, connectionProfileId: 'speech.aliyun', engineId: 'aliyun-filetrans', modelId: SPEECH_OPTIONS['aliyun-filetrans'].modelId };
    return { providerId: PROVIDER_IDS.PRIVATE_RUNTIME, connectionProfileId: 'speech.private-moss', engineId: 'moss', modelId: '' };
  }
  const privateStage = providerId === PROVIDER_IDS.PRIVATE_RUNTIME;
  const connectionProfileId = `${stage}.${privateStage ? 'private' : 'aliyun'}`;
  const modelId = providerId === PROVIDER_IDS.ALIYUN_CLOUD ? (stage === STAGES.TRANSLATION ? 'qwen-mt-plus' : 'qwen3.8-max') : '';
  return { providerId: isProviderId(providerId) ? providerId : PROVIDER_IDS.ALIYUN_CLOUD, connectionProfileId, modelId };
}

function normalizeSelection(stage, value = {}) {
  const fallback = defaultSelection(stage, value.providerId);
  const providerId = isProviderId(value.providerId) ? value.providerId : fallback.providerId;
  if (stage === STAGES.SPEECH) {
    const selectedConnection = String(value.connectionProfileId || '');
    const engineId = providerId === PROVIDER_IDS.ALIYUN_CLOUD ? 'aliyun-filetrans'
      : (selectedConnection === 'speech.private-funasr' ? 'funasr-meeting' : (selectedConnection === 'speech.private-moss' ? 'moss' : (isPrivateEngine(value.engineId) ? value.engineId : fallback.engineId)));
    const option = SPEECH_OPTIONS[engineId];
    return {
      providerId,
      connectionProfileId: option.connectionProfileId,
      engineId,
      modelId: providerId === PROVIDER_IDS.ALIYUN_CLOUD ? String(value.modelId || option.modelId).trim() : String(value.modelId || '').trim(),
      ...(typeof value.modelRevision === 'string' && value.modelRevision.trim() ? { modelRevision: value.modelRevision.trim() } : {}),
      ...(typeof value.profileRevision === 'string' && value.profileRevision.trim() ? { profileRevision: value.profileRevision.trim() } : {}),
    };
  }
  const expectedConnection = `${stage}.${providerId === PROVIDER_IDS.PRIVATE_RUNTIME ? 'private' : 'aliyun'}`;
  const defaultModel = providerId === PROVIDER_IDS.ALIYUN_CLOUD ? (stage === STAGES.TRANSLATION ? 'qwen-mt-plus' : 'qwen3.8-max') : '';
  return {
    providerId,
    connectionProfileId: expectedConnection,
    modelId: defaultModel ? String(value.modelId || defaultModel).trim() : String(value.modelId || '').trim(),
    ...(typeof value.modelRevision === 'string' && value.modelRevision.trim() ? { modelRevision: value.modelRevision.trim() } : {}),
    ...(typeof value.profileRevision === 'string' && value.profileRevision.trim() ? { profileRevision: value.profileRevision.trim() } : {}),
  };
}

function selectedSpeechCapability(capabilities, engineId) {
  return capabilities?.speech?.[engineId]
    || (engineId === 'moss' && capabilities?.speech?.available ? { ...capabilities.speech.model, available: true } : null);
}

function runtimeErrorDetail(error) {
  const message = error instanceof Error ? error.message : 'Unknown Runtime error.';
  if (/HTTP 401/.test(message)) return 'The saved Runtime token was rejected.';
  if (/HTTP 403/.test(message)) return 'The Runtime denied this request.';
  return message.slice(0, 240);
}

function publicCatalog() {
  return {
    providers: [
      { id: PROVIDER_IDS.PRIVATE_RUNTIME, labelKey: 'private', stages: [STAGES.SPEECH, STAGES.TRANSLATION, STAGES.SUMMARY], speechOptions: [SPEECH_OPTIONS.moss, SPEECH_OPTIONS['funasr-meeting']] },
      { id: PROVIDER_IDS.ALIYUN_CLOUD, labelKey: 'aliyun', stages: [STAGES.SPEECH, STAGES.TRANSLATION, STAGES.SUMMARY], speechOptions: [SPEECH_OPTIONS['aliyun-filetrans']] },
    ],
    connections: Object.values(CONNECTIONS),
  };
}

class RecordingProviderRegistry {
  constructor({ credentialStore, aliyunProfileStore, createRuntimeClient = (connection) => new RecordingRuntimeClient(connection) }) {
    this.credentialStore = credentialStore;
    this.aliyunProfileStore = aliyunProfileStore;
    this.createRuntimeClient = createRuntimeClient;
  }

  publicCatalog() { return publicCatalog(); }
  normalizeSelection(stage, value) { return normalizeSelection(stage, value); }
  defaultSelection(stage, providerId) { return defaultSelection(stage, providerId); }
  connection(profileId) { return connection(profileId); }

  async privateClient(profileId) { return this.createRuntimeClient(await this.credentialStore.connection(profileId)); }
  async cloudProfile(profileId) { return this.aliyunProfileStore.resolve(profileId); }

  async privateStatus(profileId, engineId) {
    const profile = await this.credentialStore.status(profileId);
    if (!profile.credentialConfigured || !profile.runtimeBaseUrl) return { state: 'unconfigured', engineId };
    try {
      const client = await this.privateClient(profileId);
      const [health, capabilities] = await Promise.all([client.health(), client.capabilities()]);
      const speech = selectedSpeechCapability(capabilities, engineId);
      if (health?.status !== 'ok') return { state: 'unavailable', engineId, detail: 'The Runtime health check did not report ok.' };
      if (!speech?.available) return {
        state: speech?.availabilityReason === 'worker-unreachable' ? 'unavailable' : 'disabled', engineId,
        detail: speech?.availabilityReason || '',
        translationModels: Array.isArray(capabilities.translationModels) ? capabilities.translationModels : [],
        summaryModels: Array.isArray(capabilities.summaryModels) ? capabilities.summaryModels : [],
        summaryCapabilities: { summaryPrompt: Boolean(capabilities.summaryPrompt), summaryRepair: Boolean(capabilities.summaryRepair), summaryTemplateMetadata: Boolean(capabilities.summaryTemplateMetadata) },
      };
      return {
        state: 'ready', engineId, modelId: speech.model || speech.id || '', modelRevision: speech.modelRevision || speech.revision || '',
        backend: speech.backend || '', profileRevision: capabilities.runtimeProfileRevision || health.profileRevision || '',
        components: speech.components || undefined,
        validatedMaxDurationSec: speech.validatedMaxDurationSec,
        translationModels: Array.isArray(capabilities.translationModels) ? capabilities.translationModels : [],
        summaryModels: Array.isArray(capabilities.summaryModels) ? capabilities.summaryModels : [],
        summaryCapabilities: { summaryPrompt: Boolean(capabilities.summaryPrompt), summaryRepair: Boolean(capabilities.summaryRepair), summaryTemplateMetadata: Boolean(capabilities.summaryTemplateMetadata) },
      };
    } catch (error) { return { state: 'unavailable', engineId, detail: runtimeErrorDetail(error) }; }
  }

  async status(stage, selection) {
    if (!isStage(stage)) throw new Error('Unsupported recording provider stage.');
    const normalized = normalizeSelection(stage, selection);
    if (normalized.providerId === PROVIDER_IDS.PRIVATE_RUNTIME) {
      if (stage === STAGES.SPEECH) return this.privateStatus(normalized.connectionProfileId, normalized.engineId);
      const profile = await this.credentialStore.status(normalized.connectionProfileId);
      if (!profile.credentialConfigured || !profile.runtimeBaseUrl) return { state: 'unconfigured' };
      try {
        const capabilities = await (await this.privateClient(normalized.connectionProfileId)).capabilities();
        const models = stage === STAGES.TRANSLATION ? capabilities.translationModels : capabilities.summaryModels;
        return { state: Array.isArray(models) && models.length ? 'ready' : 'disabled', models: Array.isArray(models) ? models : [], profileRevision: capabilities.runtimeProfileRevision || '', summaryCapabilities: stage === STAGES.SUMMARY ? { summaryPrompt: Boolean(capabilities.summaryPrompt), summaryRepair: Boolean(capabilities.summaryRepair), summaryTemplateMetadata: Boolean(capabilities.summaryTemplateMetadata) } : undefined };
      } catch (error) { return { state: 'unavailable', detail: runtimeErrorDetail(error) }; }
    }
    const profile = await this.aliyunProfileStore.status(normalized.connectionProfileId);
    return { state: profile.configured ? 'ready' : 'unconfigured', modelId: normalized.modelId, profileRevision: profile.profileRevision || '' };
  }
}

module.exports = { CONNECTIONS, PROVIDER_IDS, RecordingProviderRegistry, SPEECH_OPTIONS, STAGES, defaultSelection, isPrivateEngine, isStage, normalizeSelection, selectedSpeechCapability };
