const os = require('os');
const path = require('path');
const { mkdtemp, readFile, rm } = require('fs/promises');
const { AliyunCloudProfileStore } = require('./aliyun-cloud-profile-store');

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`),
  decryptString: (value) => value.toString('utf8').replace(/^encrypted:/, ''),
};
const createStore = (directory) => new AliyunCloudProfileStore({ app: { getPath: () => directory }, safeStorage });

describe('Aliyun cloud POC profile store', () => {
  it('encrypts credentials at rest and never returns them in a normal status response', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sokuji-aliyun-profile-'));
    const store = createStore(directory);
    try {
      await store.save('aliyun-default', { workspaceId: 'workspace1', ossBucket: 'bucket1', ossEndpoint: 'https://oss-cn-beijing.aliyuncs.com', dashscopeApiKey: 'dashscope-key', ossAccessKeyId: 'ak', ossAccessKeySecret: 'secret' });
      const status = await store.status('aliyun-default');
      expect(status).toMatchObject({ configured: true, workspaceId: 'workspace1' });
      expect(JSON.stringify(status)).not.toMatch(/dashscope-key|secret/);
      const stored = await readFile(path.join(directory, 'recording-aliyun-profiles.json'), 'utf8');
      expect(stored).not.toMatch(/dashscope-key|"secret"/);
      expect(stored).toMatch(/dashscopeApiKeyEncrypted/);
      await expect(store.status('aliyun-default', { includeSecrets: true })).resolves.toMatchObject({ dashscopeApiKey: 'dashscope-key', ossAccessKeySecret: 'secret' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('persists incomplete cloud speech drafts, but refuses to execute them until OSS is complete', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sokuji-aliyun-profile-'));
    const store = createStore(directory);
    try {
      await store.save('translation.aliyun', { workspaceId: 'workspace1', dashscopeApiKey: 'dashscope-key' });
      await store.save('speech.aliyun', { workspaceId: 'workspace1', dashscopeApiKey: 'dashscope-key' });
      await expect(store.status('speech.aliyun')).resolves.toMatchObject({ configured: false });
      await expect(store.resolve('speech.aliyun')).rejects.toThrow(/ossBucket/i);
      expect(await store.status('translation.aliyun')).toMatchObject({ apiBaseUrl: 'https://workspace1.cn-beijing.maas.aliyuncs.com', requiresOss: false });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('persists a user-selected API endpoint and model for the stage', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sokuji-aliyun-profile-'));
    const store = createStore(directory);
    try {
      await store.save('translation.aliyun', { workspaceId: 'workspace1', dashscopeApiKey: 'dashscope-key', apiBaseUrl: 'https://proxy.example/v1/', modelId: 'custom-mt-model' });
      await expect(store.status('translation.aliyun')).resolves.toMatchObject({ apiBaseUrl: 'https://proxy.example/v1', modelId: 'custom-mt-model' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('accepts the standard OSS endpoint hostname entered in the console', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sokuji-aliyun-profile-'));
    const store = createStore(directory);
    try {
      await store.save('speech.aliyun', { workspaceId: 'workspace1', dashscopeApiKey: 'dashscope-key', ossBucket: 'bucket1', ossEndpoint: 'bucket1.oss-cn-beijing.aliyuncs.com', ossAccessKeyId: 'ak', ossAccessKeySecret: 'secret' });
      await expect(store.resolve('speech.aliyun')).resolves.toMatchObject({ ossEndpoint: 'https://bucket1.oss-cn-beijing.aliyuncs.com' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('migrates an existing plaintext profile the first time it is read', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sokuji-aliyun-profile-'));
    const store = createStore(directory);
    try {
      await require('fs/promises').writeFile(path.join(directory, 'recording-aliyun-profiles.json'), JSON.stringify({ version: 1, profiles: { 'translation.aliyun': { workspaceId: 'workspace1', dashscopeApiKey: 'legacy-key', modelId: 'qwen-mt-plus' } } }));
      await expect(store.resolve('translation.aliyun')).resolves.toMatchObject({ dashscopeApiKey: 'legacy-key' });
      const stored = await readFile(path.join(directory, 'recording-aliyun-profiles.json'), 'utf8');
      expect(stored).not.toContain('legacy-key');
      expect(stored).toContain('dashscopeApiKeyEncrypted');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
