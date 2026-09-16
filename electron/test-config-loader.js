const TEST_CONFIG_ENDPOINT = 'http://transcription.intanavi.cn:32780/v1/test-config/load';
const PRIVATE_PROFILE_IDS = ['speech.private-moss', 'speech.private-funasr'];
const ALIYUN_PROFILE_IDS = ['speech.aliyun', 'translation.aliyun', 'summary.aliyun'];

function requiredString(value, message) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message);
  return value.trim();
}

function validatePayload(payload) {
  if (!payload || payload.version !== 1 || !requiredString(payload.revision, 'Test configuration revision is invalid.')) {
    throw new Error('Test configuration is invalid.');
  }
  const recording = payload.recording;
  if (!recording || typeof recording !== 'object' || !recording.processingSettings || !recording.privateProfiles || !recording.aliyunProfiles) {
    throw new Error('Recording test configuration is invalid.');
  }
  const settings = recording.processingSettings;
  const speech = settings.speech;
  const translation = settings.translation;
  const summary = settings.summary;
  if (
    settings.sourceLanguageMode !== 'auto' || settings.targetLanguage !== 'ja'
    || speech?.providerId !== 'private-runtime' || speech?.connectionProfileId !== 'speech.private-moss' || speech?.engineId !== 'moss'
    || translation?.enabled !== true || translation?.providerId !== 'aliyun-cloud' || translation?.connectionProfileId !== 'translation.aliyun' || !requiredString(translation?.modelId, 'Translation model is missing.')
    || summary?.enabled !== true || summary?.providerId !== 'aliyun-cloud' || summary?.connectionProfileId !== 'summary.aliyun' || !requiredString(summary?.modelId, 'Summary model is missing.')
  ) throw new Error('Recording processing defaults are invalid.');
  for (const id of PRIVATE_PROFILE_IDS) {
    const profile = recording.privateProfiles[id];
    requiredString(profile?.runtimeBaseUrl, 'Private Runtime URL is missing.');
    requiredString(profile?.token, 'Private Runtime token is missing.');
  }
  for (const id of ALIYUN_PROFILE_IDS) {
    const profile = recording.aliyunProfiles[id];
    if (!profile || typeof profile !== 'object') throw new Error('Aliyun test configuration is invalid.');
    requiredString(profile.workspaceId, 'Aliyun workspace is missing.');
    requiredString(profile.dashscopeApiKey, 'Aliyun API Key is missing.');
    requiredString(profile.modelId, 'Aliyun model is missing.');
  }
  for (const field of ['ossBucket', 'ossEndpoint', 'ossAccessKeyId', 'ossAccessKeySecret']) requiredString(recording.aliyunProfiles['speech.aliyun'][field], 'Aliyun OSS configuration is missing.');
  const ast2 = payload.volcengineAST2;
  requiredString(ast2?.apiKey, 'Doubao API Key is missing.');
  return payload;
}

async function fetchPayload({ username, password, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(TEST_CONFIG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ username, password }),
      signal: controller.signal,
    });
    if (response.status === 401) throw new Error('用户名或密码不正确。');
    if (response.status === 429) throw new Error('尝试次数过多，请稍后再试。');
    if (!response.ok) throw new Error('测试配置暂时不可用。');
    return validatePayload(await response.json());
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('连接配置服务超时。');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function applyPayload(payload, { credentialStore, aliyunProfileStore, processingSettingsStore, secureSettingsStore }) {
  const config = validatePayload(payload);
  const snapshot = {
    credentials: await credentialStore.readAll(),
    aliyun: await aliyunProfileStore.readAll(),
    processing: await processingSettingsStore.get(),
    secure: await secureSettingsStore.readAll(),
  };
  try {
    for (const profileId of PRIVATE_PROFILE_IDS) {
      const profile = config.recording.privateProfiles[profileId];
      await credentialStore.save(profileId, profile.token, profile.runtimeBaseUrl);
    }
    for (const profileId of ALIYUN_PROFILE_IDS) {
      await aliyunProfileStore.save(profileId, config.recording.aliyunProfiles[profileId]);
    }
    const processingSettings = await processingSettingsStore.save(config.recording.processingSettings);
    await secureSettingsStore.save('volcengineAST2.apiKey', config.volcengineAST2.apiKey);
    return {
      version: config.version,
      revision: config.revision,
      loadedAt: new Date().toISOString(),
      processingSettings,
      volcengineAST2: config.volcengineAST2,
    };
  } catch (error) {
    await Promise.allSettled([
      credentialStore.replaceAll(snapshot.credentials),
      aliyunProfileStore.replaceAll(snapshot.aliyun),
      processingSettingsStore.save(snapshot.processing),
      secureSettingsStore.replaceAll(snapshot.secure),
    ]);
    throw error;
  }
}

async function loadAndApplyTestConfig(credentials, stores) {
  const username = requiredString(credentials?.username, '请输入用户名。');
  const password = requiredString(credentials?.password, '请输入密码。');
  return applyPayload(await fetchPayload({ username, password }), stores);
}

module.exports = { TEST_CONFIG_ENDPOINT, applyPayload, fetchPayload, loadAndApplyTestConfig, validatePayload };
