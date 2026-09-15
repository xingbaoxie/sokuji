import { describe, expect, it } from 'vitest';
import { VolcengineAST2ProviderConfig } from './VolcengineAST2ProviderConfig';
import type { PreparePorts } from './ProviderDescriptor';

describe('VolcengineAST2ProviderConfig.prepareToStart', () => {
  const descriptor = new VolcengineAST2ProviderConfig();

  it('blocks a persisted ordinary same-language pair before opening a session', async () => {
    const result = await descriptor.prepareToStart!(
      { sourceLanguage: 'zh', targetLanguage: 'zh' },
      {} as PreparePorts,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('different source and target');
  });

  it('keeps the special zhen/zhen bidirectional mode valid', async () => {
    await expect(
      descriptor.prepareToStart!(
        { sourceLanguage: 'zhen', targetLanguage: 'zhen' },
        {} as PreparePorts,
      ),
    ).resolves.toEqual({ ok: true });
  });
});
