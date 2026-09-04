const { mkdir, readFile, rename, writeFile } = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const ALIYUN_SPEECH_PROFILE_ID = 'speech.aliyun';
const DEFAULT_MODEL_IDS = Object.freeze({
  'speech.aliyun': 'qwen-audio-3.0-asr-flash-filetrans',
  'translation.aliyun': 'qwen-mt-plus',
  'summary.aliyun': 'qwen3.8-max',
});

function profileFile(app) { return path.join(app.getPath('userData'), 'recording-aliyun-profiles.json'); }

function normalizePrefix(value) {
  return String(value || 'sokuji-recordings').trim().replace(/^\/+|\/+$/g, '') || 'sokuji-recordings';
}

function apiBaseUrl(workspaceId) { return `https://${workspaceId}.cn-beijing.maas.aliyuncs.com`; }

function normalizeApiBaseUrl(value, workspaceId) {
  const raw = String(value || apiBaseUrl(workspaceId)).trim();
  const endpoint = new URL(raw);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('Bailian API endpoint must be http or https.');
  return endpoint.toString().replace(/\/$/, '');
}

function normalizeOssEndpoint(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const endpoint = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('OSS endpoint must be http or https.');
  return endpoint.toString().replace(/\/$/, '');
}

function requiredFields(requiresOss) {
  return requiresOss
    ? ['workspaceId', 'dashscopeApiKey', 'ossBucket', 'ossEndpoint', 'ossAccessKeyId', 'ossAccessKeySecret']
    : ['workspaceId', 'dashscopeApiKey'];
}

function normalizeProfile(input, { requiresOss = false, defaultModelId = '' } = {}) {
  const workspaceId = String(input?.workspaceId || '').trim();
  if (workspaceId && !/^[-a-z0-9]+$/i.test(workspaceId)) throw new Error('Aliyun Workspace ID is invalid.');
  const endpoint = normalizeOssEndpoint(input.ossEndpoint);
  return {
    region: 'cn-beijing', workspaceId,
    apiBaseUrl: workspaceId ? normalizeApiBaseUrl(input.apiBaseUrl, workspaceId) : String(input.apiBaseUrl || '').trim(),
    modelId: String(input.modelId || defaultModelId).trim(), ossBucket: String(input.ossBucket || '').trim(),
    ossEndpoint: endpoint, objectPrefix: normalizePrefix(input.objectPrefix),
    profileRevision: String(input.profileRevision || 'aliyun-beijing-poc-v1').trim(),
    dashscopeApiKey: String(input.dashscopeApiKey).trim(), ossAccessKeyId: String(input.ossAccessKeyId || '').trim(),
    ossAccessKeySecret: String(input.ossAccessKeySecret || '').trim(), requiresOss, updatedAt: new Date().toISOString(),
  };
}

function profileConfigured(profile, requiresOss) {
  return requiredFields(requiresOss).every((key) => String(profile?.[key] || '').trim());
}

function validateProfile(input, options = {}) {
  const profile = normalizeProfile(input, options);
  for (const key of requiredFields(options.requiresOss)) {
    if (!String(profile[key] || '').trim()) throw new Error(`Aliyun profile field ${key} is required.`);
  }
  return profile;
}

async function atomicWrite(file, value) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, file);
}

class AliyunCloudProfileStore {
  constructor({ app }) { this.app = app; }
  async readAll() { try { return JSON.parse(await readFile(profileFile(this.app), 'utf8')); } catch (error) { if (error?.code === 'ENOENT') return { version: 1, profiles: {} }; throw error; } }
  async save(profileId, input) {
    if (!profileId) throw new Error('Aliyun profile id is required.');
    const document = await this.readAll();
    // Secret fields are intentionally write-only. A settings card may update
    // its non-secret fields without forcing the user to re-enter every key.
    // Settings are written field by field, just like subtitle provider
    // settings.  A partially entered profile is valid storage; it only becomes
    // executable after resolve() verifies every field required by the stage.
    document.profiles[profileId] = normalizeProfile(
      { ...(document.profiles[profileId] || {}), ...(input || {}) },
      { requiresOss: profileId === ALIYUN_SPEECH_PROFILE_ID, defaultModelId: DEFAULT_MODEL_IDS[profileId] || '' },
    );
    await mkdir(path.dirname(profileFile(this.app)), { recursive: true, mode: 0o700 });
    await atomicWrite(profileFile(this.app), document);
    return this.status(profileId);
  }
  async resolve(profileId) {
    const profile = (await this.readAll()).profiles[profileId];
    if (!profile) throw new Error('Aliyun cloud profile is not configured.');
    return validateProfile(profile, { requiresOss: profileId === ALIYUN_SPEECH_PROFILE_ID, defaultModelId: DEFAULT_MODEL_IDS[profileId] || '' });
  }
  async status(profileId, { includeSecrets = false } = {}) {
    const value = (await this.readAll()).profiles[profileId];
    return value ? {
      profileId, configured: profileConfigured(value, profileId === ALIYUN_SPEECH_PROFILE_ID), region: value.region, workspaceId: value.workspaceId, apiBaseUrl: value.apiBaseUrl || (value.workspaceId ? apiBaseUrl(value.workspaceId) : ''), modelId: value.modelId || DEFAULT_MODEL_IDS[profileId] || '', ossBucket: value.ossBucket,
      ossEndpoint: value.ossEndpoint, objectPrefix: value.objectPrefix, profileRevision: value.profileRevision,
      requiresOss: Boolean(value.requiresOss),
      ...(includeSecrets ? { dashscopeApiKey: value.dashscopeApiKey, ossAccessKeyId: value.ossAccessKeyId, ossAccessKeySecret: value.ossAccessKeySecret } : {}),
    } : { profileId, configured: false, region: 'cn-beijing' };
  }
  async copy(fromProfileId, toProfileId) {
    const document = await this.readAll();
    if (document.profiles[toProfileId] || !document.profiles[fromProfileId]) return false;
    const source = document.profiles[fromProfileId];
    document.profiles[toProfileId] = { ...source, requiresOss: toProfileId === ALIYUN_SPEECH_PROFILE_ID, updatedAt: new Date().toISOString() };
    await mkdir(path.dirname(profileFile(this.app)), { recursive: true, mode: 0o700 });
    await atomicWrite(profileFile(this.app), document);
    return true;
  }
  async remove(profileId) { const document = await this.readAll(); delete document.profiles[profileId]; await mkdir(path.dirname(profileFile(this.app)), { recursive: true, mode: 0o700 }); await atomicWrite(profileFile(this.app), document); return this.status(profileId); }
}

module.exports = { ALIYUN_SPEECH_PROFILE_ID, AliyunCloudProfileStore, DEFAULT_MODEL_IDS, apiBaseUrl, normalizeApiBaseUrl, normalizeOssEndpoint, validateProfile };
