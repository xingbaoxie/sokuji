const os = require('os');
const path = require('path');
const { mkdtemp, readFile, rm, stat } = require('fs/promises');
const { SecureSettingsStore } = require('./secure-settings-store');

describe('secure settings store', () => {
  it('falls back to an owner-only file when the desktop keychain is unavailable', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sokuji-secure-settings-'));
    const store = new SecureSettingsStore({ app: { getPath: () => directory }, safeStorage: { isEncryptionAvailable: () => false } });
    try {
      await expect(store.save('volcengineAST2.apiKey', 'test-key')).resolves.toEqual({ configured: true, encrypted: false });
      await expect(store.get('volcengineAST2.apiKey')).resolves.toBe('test-key');
      const file = path.join(directory, 'secure-settings.json');
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(await readFile(file, 'utf8')).toContain('test-key');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('falls back when a keychain advertises availability but encryption fails', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sokuji-secure-settings-'));
    const store = new SecureSettingsStore({ app: { getPath: () => directory }, safeStorage: { isEncryptionAvailable: () => true, encryptString: () => { throw new Error('keychain unavailable'); } } });
    try {
      await expect(store.save('volcengineAST2.apiKey', 'test-key')).resolves.toMatchObject({ encrypted: false });
      await expect(store.get('volcengineAST2.apiKey')).resolves.toBe('test-key');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
