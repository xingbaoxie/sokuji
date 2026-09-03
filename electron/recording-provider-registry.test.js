import { describe, expect, it } from 'vitest';
import { PROVIDER_IDS, RecordingProviderRegistry, STAGES, normalizeSelection } from './recording-provider-registry.js';

describe('recording provider registry', () => {
  it('maps each private speech connection to its engine and keeps cloud Filetrans fixed', () => {
    expect(normalizeSelection(STAGES.SPEECH, { providerId: PROVIDER_IDS.PRIVATE_RUNTIME, connectionProfileId: 'speech.private-funasr' }))
      .toMatchObject({ providerId: 'private-runtime', connectionProfileId: 'speech.private-funasr', engineId: 'funasr-meeting' });
    expect(normalizeSelection(STAGES.SPEECH, { providerId: PROVIDER_IDS.ALIYUN_CLOUD }))
      .toMatchObject({ connectionProfileId: 'speech.aliyun', engineId: 'aliyun-filetrans', modelId: 'qwen-audio-3.0-asr-flash-filetrans' });
  });

  it('keeps an explicitly selected cloud model in the job selection', () => {
    expect(normalizeSelection(STAGES.SPEECH, { providerId: PROVIDER_IDS.ALIYUN_CLOUD, modelId: 'custom-filetrans' }))
      .toMatchObject({ engineId: 'aliyun-filetrans', modelId: 'custom-filetrans' });
    expect(normalizeSelection(STAGES.TRANSLATION, { providerId: PROVIDER_IDS.ALIYUN_CLOUD, modelId: 'custom-mt' }))
      .toMatchObject({ modelId: 'custom-mt' });
  });

  it('publishes only public provider metadata to the renderer', () => {
    const registry = new RecordingProviderRegistry({ credentialStore: {}, aliyunProfileStore: {} });
    const catalog = registry.publicCatalog();
    expect(catalog.providers.map((item) => item.id)).toEqual(['private-runtime', 'aliyun-cloud']);
    expect(JSON.stringify(catalog)).not.toMatch(/token|secret|accesskey/i);
  });

  it('reports unavailable private text capability instead of inventing a model', async () => {
    const registry = new RecordingProviderRegistry({
      credentialStore: {
        status: async () => ({ credentialConfigured: true, runtimeBaseUrl: 'http://runtime' }),
        connection: async () => ({ baseUrl: 'http://runtime', token: 'not-returned' }),
      },
      aliyunProfileStore: {},
      createRuntimeClient: () => ({ capabilities: async () => ({ translationModels: [], runtimeProfileRevision: 'r1' }) }),
    });
    await expect(registry.status(STAGES.TRANSLATION, { providerId: 'private-runtime', connectionProfileId: 'translation.private', modelId: '' }))
      .resolves.toMatchObject({ state: 'disabled', models: [] });
  });

  it('reports a stopped speech Worker as unavailable rather than ready', async () => {
    const registry = new RecordingProviderRegistry({
      credentialStore: {
        status: async () => ({ credentialConfigured: true, runtimeBaseUrl: 'http://runtime' }),
        connection: async () => ({ baseUrl: 'http://runtime', token: 'not-returned' }),
      },
      aliyunProfileStore: {},
      createRuntimeClient: () => ({
        health: async () => ({ status: 'ok' }),
        capabilities: async () => ({ speech: { moss: { available: false, availabilityReason: 'worker-unreachable' } }, translationModels: [], summaryModels: [] }),
      }),
    });
    await expect(registry.status(STAGES.SPEECH, { providerId: 'private-runtime', connectionProfileId: 'speech.private-moss', engineId: 'moss' }))
      .resolves.toMatchObject({ state: 'unavailable', detail: 'worker-unreachable' });
  });

  it('rejects an unknown stage at the IPC-facing registry boundary', async () => {
    const registry = new RecordingProviderRegistry({ credentialStore: {}, aliyunProfileStore: {} });
    await expect(registry.status('not-a-stage', {})).rejects.toThrow(/unsupported recording provider stage/i);
  });
});
