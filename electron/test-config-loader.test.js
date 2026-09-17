const { applyPayload, fetchPayload, validatePayload } = require('./test-config-loader');

const payload = {
  version: 1,
  revision: 'test-20260916-01',
  recording: {
    processingSettings: {
      sourceLanguageMode: 'auto', targetLanguage: 'zh', hotwords: [],
      speech: { providerId: 'private-runtime', connectionProfileId: 'speech.private-moss', engineId: 'moss' },
      translation: { enabled: true, providerId: 'aliyun-cloud', connectionProfileId: 'translation.aliyun', modelId: 'qwen-mt-plus' },
      summary: { enabled: true, providerId: 'aliyun-cloud', connectionProfileId: 'summary.aliyun', modelId: 'qwen3.8-max', inputMode: 'bilingual', reportLanguage: 'zh', templateId: 'general-meeting' },
    },
    privateProfiles: {
      'speech.private-moss': { runtimeBaseUrl: 'http://runtime.test', token: 'moss-token' },
      'speech.private-funasr': { runtimeBaseUrl: 'http://runtime.test', token: 'funasr-token' },
    },
    aliyunProfiles: {
      'speech.aliyun': { workspaceId: 'ws-test', dashscopeApiKey: 'key', modelId: 'qwen-audio-3.0-asr-flash-filetrans', ossBucket: 'bucket', ossEndpoint: 'https://bucket.oss.test', ossAccessKeyId: 'id', ossAccessKeySecret: 'secret' },
      'translation.aliyun': { workspaceId: 'ws-test', dashscopeApiKey: 'key', modelId: 'qwen-mt-plus' },
      'summary.aliyun': { workspaceId: 'ws-test', dashscopeApiKey: 'key', modelId: 'qwen3.8-max' },
    },
  },
  volcengineAST2: { apiKey: 'ast2-key', sourceLanguage: 'zh', targetLanguage: 'ja', turnDetectionMode: 'Auto', hotWordTableId: '', replacementTableId: '', glossaryTableId: '' },
};

function createStores({ failOn } = {}) {
  const calls = [];
  const documents = {
    credentials: { version: 1, profiles: { untouched: { secret: 'old' } } },
    aliyun: { version: 1, profiles: { untouched: { value: 'old' } } },
    processing: { sourceLanguageMode: 'auto', targetLanguage: 'en' },
    secure: { version: 1, values: { untouched: { value: 'old' } } },
  };
  const maybeFail = (operation) => { if (failOn === operation) throw new Error(`failed ${operation}`); };
  return {
    calls,
    documents,
    stores: {
      credentialStore: {
        readAll: async () => structuredClone(documents.credentials),
        save: async (id, token, runtimeBaseUrl) => { maybeFail(`credential:${id}`); calls.push(['credential', id, token, runtimeBaseUrl]); },
        replaceAll: async (value) => { documents.credentials = value; calls.push(['rollback', 'credentials']); },
      },
      aliyunProfileStore: {
        readAll: async () => structuredClone(documents.aliyun),
        save: async (id, value) => { maybeFail(`aliyun:${id}`); calls.push(['aliyun', id, value]); },
        replaceAll: async (value) => { documents.aliyun = value; calls.push(['rollback', 'aliyun']); },
      },
      processingSettingsStore: {
        get: async () => structuredClone(documents.processing),
        save: async (value) => { maybeFail('processing'); documents.processing = value; calls.push(['processing', value]); return value; },
      },
      secureSettingsStore: {
        readAll: async () => structuredClone(documents.secure),
        save: async (key, value) => { maybeFail('secure'); calls.push(['secure', key, value]); },
        replaceAll: async (value) => { documents.secure = value; calls.push(['rollback', 'secure']); },
      },
    },
  };
}

describe('test configuration loader', () => {
  it('only writes the documented managed profiles and preserves unrelated settings', async () => {
    const { stores, calls } = createStores();
    const config = structuredClone(payload);
    config.recording.privateProfiles.unrelated = { runtimeBaseUrl: 'http://ignored.test', token: 'ignored' };
    config.recording.aliyunProfiles.unrelated = { workspaceId: 'ignored' };

    await expect(applyPayload(config, stores)).resolves.toMatchObject({ version: 1, revision: payload.revision, volcengineAST2: { apiKey: 'ast2-key' } });
    expect(calls.filter(([kind]) => kind === 'credential').map(([, id]) => id)).toEqual(['speech.private-moss', 'speech.private-funasr']);
    expect(calls.filter(([kind]) => kind === 'aliyun').map(([, id]) => id)).toEqual(['speech.aliyun', 'translation.aliyun', 'summary.aliyun']);
    expect(calls).toContainEqual(['secure', 'volcengineAST2.apiKey', 'ast2-key']);
  });

  it('restores every managed store when a write fails', async () => {
    const { stores, calls, documents } = createStores({ failOn: 'secure' });
    const before = structuredClone(documents);
    await expect(applyPayload(payload, stores)).rejects.toThrow('failed secure');
    expect(documents.credentials).toEqual(before.credentials);
    expect(documents.aliyun).toEqual(before.aliyun);
    expect(documents.processing).toEqual(before.processing);
    expect(documents.secure).toEqual(before.secure);
    expect(calls.filter(([kind]) => kind === 'rollback').map(([, store]) => store).sort()).toEqual(['aliyun', 'credentials', 'secure']);
  });

  it('does not call the service for an incomplete response', () => {
    expect(() => validatePayload({ version: 1, revision: 'bad' })).toThrow(/recording/i);
  });

  it('sends a no-store JSON login request and maps generic authentication failure', async () => {
    const fetchImpl = async (_url, request) => {
      expect(request.headers['Cache-Control']).toBe('no-store');
      expect(JSON.parse(request.body)).toEqual({ username: 'tester', password: 'wrong' });
      return { status: 401, ok: false, json: async () => ({}) };
    };
    await expect(fetchPayload({ username: 'tester', password: 'wrong', fetchImpl })).rejects.toThrow('用户名或密码不正确');
  });
});
