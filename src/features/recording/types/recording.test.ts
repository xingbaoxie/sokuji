import { describe, expect, it } from 'vitest';
import { defaultRecordingJobConfig, validateRecordingJobConfig } from './recording';

describe('recording job config', () => {
  it('starts with a complete, secret-free POC config', () => {
    const config = defaultRecordingJobConfig();
    expect(config.speech).toMatchObject({ providerId: 'private-runtime', connectionProfileId: 'speech.private-moss', engineId: 'moss' });
    expect(config).not.toHaveProperty('runtimeMode');
    expect(config.translation.enabled).toBe(false);
    expect(config.summary.enabled).toBe(false);
    expect(JSON.stringify(config)).not.toMatch(/api.?key|secret|token/i);
  });

  it('requires a source language in fixed mode', () => {
    const config = { ...defaultRecordingJobConfig(), sourceLanguageMode: 'fixed' as const };
    expect(validateRecordingJobConfig(config)).toMatch(/source language/i);
  });

  it('rejects a translated summary when translation is disabled', () => {
    const config = {
      ...defaultRecordingJobConfig(),
      translation: { ...defaultRecordingJobConfig().translation, enabled: false },
      summary: { ...defaultRecordingJobConfig().summary, enabled: true, inputMode: 'translated' as const },
    };
    expect(validateRecordingJobConfig(config)).toMatch(/translation/i);
  });
});
