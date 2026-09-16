const { mkdir, readFile, rename, writeFile } = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function storeFile(app) {
  return path.join(app.getPath('userData'), 'secure-settings.json');
}

async function writeAtomic(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, file);
}

/**
 * Small main-process-only store for provider secrets that otherwise live in
 * renderer settings.  Electron safeStorage is preferred; the fallback keeps
 * the test-config flow usable on Linux desktop environments without a keyring.
 * The fallback file is deliberately separate from ordinary renderer storage
 * and has owner-only permissions.
 */
class SecureSettingsStore {
  constructor({ app, safeStorage }) {
    this.app = app;
    this.safeStorage = safeStorage;
  }

  async readAll() {
    try { return JSON.parse(await readFile(storeFile(this.app), 'utf8')); }
    catch (error) {
      if (error?.code === 'ENOENT') return { version: 1, values: {} };
      throw error;
    }
  }

  async save(key, value) {
    if (!key || typeof value !== 'string') throw new Error('A secure setting key and string value are required.');
    const document = await this.readAll();
    document.values = document.values && typeof document.values === 'object' ? document.values : {};
    let encrypted = false;
    try {
      if (this.safeStorage?.isEncryptionAvailable?.()) {
        document.values[key] = { encrypted: this.safeStorage.encryptString(value).toString('base64') };
        encrypted = true;
      }
    } catch (_) {
      // Some Linux/keychain implementations only fail on their first write.
      // The owner-only fallback keeps short-lived package testing usable.
    }
    if (!encrypted) document.values[key] = { value };
    await this.replaceAll(document);
    return { configured: true, encrypted };
  }

  async get(key) {
    const entry = (await this.readAll()).values?.[key];
    if (!entry) return '';
    if (entry.encrypted) {
      if (!this.safeStorage?.isEncryptionAvailable?.()) return '';
      return this.safeStorage.decryptString(Buffer.from(entry.encrypted, 'base64'));
    }
    return typeof entry.value === 'string' ? entry.value : '';
  }

  async remove(key) {
    const document = await this.readAll();
    delete document.values[key];
    await this.replaceAll(document);
  }

  async replaceAll(document) {
    await mkdir(path.dirname(storeFile(this.app)), { recursive: true, mode: 0o700 });
    await writeAtomic(storeFile(this.app), document);
  }
}

module.exports = { SecureSettingsStore };
