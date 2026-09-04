import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { RecordingProcessingSettingsStore } from './recording-processing-settings.js';

describe('recording processing settings store', () => {
  it('creates one durable default configuration without storing credentials', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sokuji-recording-settings-'));
    const store = new RecordingProcessingSettingsStore({ app: { getPath: () => directory } });
    try {
      const initial = await store.initialize();
      expect(initial.created).toBe(true);
      expect(initial.settings.speech).toMatchObject({ providerId: 'private-runtime', engineId: 'moss', connectionProfileId: 'speech.private-moss' });
      expect(initial.settings.translation.providerId).toBe('aliyun-cloud');
      expect(JSON.stringify(initial.settings)).not.toMatch(/token|secret|apiKey/i);
      const again = await store.initialize();
      expect(again.created).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves an invalid historical summary input mode and rejects it when saving', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sokuji-recording-settings-'));
    const store = new RecordingProcessingSettingsStore({ app: { getPath: () => directory } });
    try {
      const input = {
        speech: { providerId: 'private-runtime', engineId: 'funasr-meeting' }, sourceLanguageMode: 'fixed', sourceLanguage: 'ja', targetLanguage: 'en',
        hotwords: ['Sokuji', 'Sokuji', ''], translation: { enabled: false, providerId: 'private-runtime', modelId: 'local-mt' },
        summary: { enabled: true, providerId: 'aliyun-cloud', modelId: 'qwen3.8-max', inputMode: 'bilingual' },
      };
      await expect(store.save(input)).rejects.toThrow(/translation/i);
      await writeFile(path.join(directory, 'recording-processing-settings.json'), JSON.stringify(input));
      const historical = await store.get();
      expect(historical.hotwords).toEqual(['Sokuji']);
      expect(historical.summary.inputMode).toBe('bilingual');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('upgrades the legacy root profile to independent stage profiles', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sokuji-recording-settings-'));
    const store = new RecordingProcessingSettingsStore({ app: { getPath: () => directory } });
    try {
      await writeFile(path.join(directory, 'recording-processing-settings.json'), JSON.stringify({ version: 1, scheme: 'private-funasr', profileId: 'default', translation: { enabled: true, provider: 'private-runtime' }, summary: { enabled: true, provider: 'aliyun-cloud' } }));
      const result = await store.initialize();
      expect(result.legacyProfileId).toBe('default');
      expect(result.upgraded).toBe(true);
      expect(result.settings).toMatchObject({ speech: { connectionProfileId: 'speech.private-funasr', engineId: 'funasr-meeting' }, translation: { connectionProfileId: 'translation.private' }, summary: { connectionProfileId: 'summary.aliyun' } });
      const migrated = JSON.parse(await readFile(path.join(directory, 'recording-processing-settings.json'), 'utf8'));
      expect(migrated).not.toHaveProperty('profileId');
      expect(migrated).not.toHaveProperty('scheme');
      expect(migrated).not.toHaveProperty('speechProfileId');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
