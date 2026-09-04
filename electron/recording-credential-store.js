const { mkdir, readFile, rename, writeFile } = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function credentialFile(app) {
  return path.join(app.getPath('userData'), 'recording-credentials.json');
}

function normalizeRuntimeBaseUrl(value) {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { throw new Error('Runtime URL must be a valid http or https URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Runtime URL must be an http or https origin without credentials, query, or fragment.');
  }
  return url.toString().replace(/\/$/, '');
}

async function writeAtomic(file, value) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, file);
}

class RecordingCredentialStore {
  constructor({ app, safeStorage }) {
    this.app = app;
    this.safeStorage = safeStorage;
  }

  async readAll() {
    try { return JSON.parse(await readFile(credentialFile(this.app), 'utf8')); }
    catch (error) {
      if (error && error.code === 'ENOENT') return { version: 1, profiles: {} };
      throw error;
    }
  }

  requireEncryption() {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('OS secure storage is unavailable; recording credentials cannot be saved.');
    }
  }

  async save(profileId, secret, runtimeBaseUrl = '') {
    if (!profileId || typeof secret !== 'string') throw new Error('A profile id and credential value are required.');
    const document = await this.readAll();
    const existing = document.profiles[profileId] || {};
    // Settings are persisted field-by-field, just like subtitle provider
    // settings.  An incomplete Runtime profile is valid storage but cannot be
    // resolved for a job until it has both a URL and a token.
    const next = { ...existing, runtimeBaseUrl: normalizeRuntimeBaseUrl(runtimeBaseUrl), updatedAt: new Date().toISOString() };
    if (secret.length > 0) {
      this.requireEncryption();
      next.encrypted = this.safeStorage.encryptString(secret).toString('base64');
    }
    document.profiles[profileId] = next;
    await mkdir(path.dirname(credentialFile(this.app)), { recursive: true, mode: 0o700 });
    await writeAtomic(credentialFile(this.app), document);
  }

  async resolve(profileId) {
    this.requireEncryption();
    const entry = (await this.readAll()).profiles[profileId];
    if (!entry?.encrypted) throw new Error('Credential is not configured for this Runtime profile.');
    return this.safeStorage.decryptString(Buffer.from(entry.encrypted, 'base64'));
  }

  async connection(profileId) {
    const status = await this.status(profileId);
    if (!status.runtimeBaseUrl) throw new Error('Runtime URL is not configured for this profile.');
    return { baseUrl: status.runtimeBaseUrl, token: await this.resolve(profileId) };
  }

  async remove(profileId) {
    const document = await this.readAll();
    delete document.profiles[profileId];
    await mkdir(path.dirname(credentialFile(this.app)), { recursive: true, mode: 0o700 });
    await writeAtomic(credentialFile(this.app), document);
  }

  async configured(profileId) {
    return Boolean((await this.readAll()).profiles[profileId]?.encrypted);
  }

  async copy(fromProfileId, toProfileId) {
    const document = await this.readAll();
    if (document.profiles[toProfileId] || !document.profiles[fromProfileId]) return false;
    document.profiles[toProfileId] = { ...document.profiles[fromProfileId], updatedAt: new Date().toISOString() };
    await mkdir(path.dirname(credentialFile(this.app)), { recursive: true, mode: 0o700 });
    await writeAtomic(credentialFile(this.app), document);
    return true;
  }

  async status(profileId, { includeSecret = false } = {}) {
    const entry = (await this.readAll()).profiles[profileId];
    const status = { profileId, credentialConfigured: Boolean(entry?.encrypted), runtimeBaseUrl: entry?.runtimeBaseUrl || '' };
    // The settings screen is the explicit user-facing credential editor. It
    // may request its own saved value so the user can inspect and change it.
    // All execution/status paths keep the value out of their responses.
    return includeSecret && entry?.encrypted ? { ...status, secret: await this.resolve(profileId) } : status;
  }
}

module.exports = { RecordingCredentialStore, normalizeRuntimeBaseUrl };
