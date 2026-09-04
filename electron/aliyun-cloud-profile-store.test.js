const os = require('os');
const path = require('path');
const { mkdtemp, readFile, rm } = require('fs/promises');
const { AliyunCloudProfileStore } = require('./aliyun-cloud-profile-store');

describe('Aliyun cloud POC profile store', () => {
  it('stores the POC credentials locally but never returns them in status', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sokuji-aliyun-profile-'));
    const store = new AliyunCloudProfileStore({ app: { getPath: () => directory } });
    try {
      await store.save('aliyun-default', { workspaceId: 'workspace1', ossBucket: 'bucket1', ossEndpoint: 'https://oss-cn-beijing.aliyuncs.com', dashscopeApiKey: 'dashscope-key', ossAccessKeyId: 'ak', ossAccessKeySecret: 'secret' });
      const status = await store.status('aliyun-default');
      expect(status).toMatchObject({ configured: true, workspaceId: 'workspace1' });
      expect(JSON.stringify(status)).not.toMatch(/dashscope-key|secret/);
      expect(await readFile(path.join(directory, 'recording-aliyun-profiles.json'), 'utf8')).toMatch(/dashscope-key/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('persists incomplete cloud speech drafts, but refuses to execute them until OSS is complete', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sokuji-aliyun-profile-'));
    const store = new AliyunCloudProfileStore({ app: { getPath: () => directory } });
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
    const store = new AliyunCloudProfileStore({ app: { getPath: () => directory } });
    try {
      await store.save('translation.aliyun', { workspaceId: 'workspace1', dashscopeApiKey: 'dashscope-key', apiBaseUrl: 'https://proxy.example/v1/', modelId: 'custom-mt-model' });
      await expect(store.status('translation.aliyun')).resolves.toMatchObject({ apiBaseUrl: 'https://proxy.example/v1', modelId: 'custom-mt-model' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('accepts the standard OSS endpoint hostname entered in the console', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sokuji-aliyun-profile-'));
    const store = new AliyunCloudProfileStore({ app: { getPath: () => directory } });
    try {
      await store.save('speech.aliyun', { workspaceId: 'workspace1', dashscopeApiKey: 'dashscope-key', ossBucket: 'bucket1', ossEndpoint: 'bucket1.oss-cn-beijing.aliyuncs.com', ossAccessKeyId: 'ak', ossAccessKeySecret: 'secret' });
      await expect(store.resolve('speech.aliyun')).resolves.toMatchObject({ ossEndpoint: 'https://bucket1.oss-cn-beijing.aliyuncs.com' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
