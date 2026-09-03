const os = require('os');
const path = require('path');
const { mkdtemp, rm } = require('fs/promises');
const { normalizeRuntimeBaseUrl, RecordingCredentialStore } = require('./recording-credential-store');

describe('recording credential store', () => {
  it('keeps credentials encrypted while allowing the settings editor to explicitly read them', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sokuji-credential-test-'));
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`encrypted:${value}`),
      decryptString: (value) => value.toString().replace('encrypted:', ''),
    };
    const store = new RecordingCredentialStore({ app: { getPath: () => directory }, safeStorage });
    try {
      await store.save('private-moss-default', 'not-returned-to-renderer', 'https://runtime.internal/');
      await expect(store.configured('private-moss-default')).resolves.toBe(true);
      await expect(store.resolve('private-moss-default')).resolves.toBe('not-returned-to-renderer');
      await expect(store.connection('private-moss-default')).resolves.toMatchObject({ baseUrl: 'https://runtime.internal', token: 'not-returned-to-renderer' });
      await expect(store.status('private-moss-default')).resolves.toMatchObject({ credentialConfigured: true, runtimeBaseUrl: 'https://runtime.internal' });
      await expect(store.status('private-moss-default', { includeSecret: true })).resolves.toMatchObject({ secret: 'not-returned-to-renderer' });
      await store.remove('private-moss-default');
      await expect(store.configured('private-moss-default')).resolves.toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a runtime URL containing embedded credentials', () => {
    expect(() => normalizeRuntimeBaseUrl('https://token@example.test')).toThrow(/without credentials/i);
  });
});
