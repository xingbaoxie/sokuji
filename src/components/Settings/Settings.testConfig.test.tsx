import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from '../../types/Provider';

const updateVolcengineAST2 = vi.fn(async () => undefined);
const setProvider = vi.fn(async () => undefined);
const validateApiKey = vi.fn(async () => ({ valid: true, message: '', validating: false }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock('../../stores/settingsStore', () => ({
  __esModule: true,
  default: { getState: () => ({ validateApiKey }) },
  useUIMode: () => 'advanced',
  useSetUIMode: () => vi.fn(),
  useSetProvider: () => setProvider,
  useUpdateVolcengineAST2: () => updateVolcengineAST2,
  useSettingsLoaded: () => true,
  useNavigateToSettings: () => vi.fn(),
  useSettingsNavigationTarget: () => null,
}));

vi.mock('../../stores/sessionStore', () => ({ useIsSessionActive: () => false }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('./SimpleSettings/SimpleSettings', () => ({ default: () => null }));
vi.mock('./AdvancedSettings/AdvancedSettings', () => ({ default: () => null }));
vi.mock('../../features/recording/components/RecordingSettingsSection', () => ({ default: () => null }));

vi.mock('./TestConfigSection', () => ({
  default: ({ onLoaded }: { onLoaded: (result: unknown) => Promise<void> }) => (
    <button type="button" onClick={() => void onLoaded({
      version: 1,
      revision: 'test-revision',
      loadedAt: '2026-09-16T00:00:00.000Z',
      processingSettings: {},
      volcengineAST2: {
        apiKey: 'loaded-api-key', sourceLanguage: 'zh', targetLanguage: 'ja',
        turnDetectionMode: 'Auto', hotWordTableId: '', replacementTableId: '', glossaryTableId: '',
      },
    })}>
      load-test-config
    </button>
  ),
}));

const { default: Settings } = await import('./Settings');

describe('Settings test configuration activation', () => {
  beforeEach(() => {
    updateVolcengineAST2.mockClear();
    setProvider.mockClear();
    validateApiKey.mockClear();
  });

  it('publishes the loaded Doubao key and validates it before configuration loading completes', async () => {
    render(<Settings />);
    fireEvent.click(screen.getByRole('button', { name: 'load-test-config' }));

    await waitFor(() => expect(validateApiKey).toHaveBeenCalledTimes(1));
    expect(updateVolcengineAST2).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'loaded-api-key' }));
    expect(setProvider).toHaveBeenCalledWith(Provider.VOLCENGINE_AST2);
    expect(updateVolcengineAST2.mock.invocationCallOrder[0]).toBeLessThan(setProvider.mock.invocationCallOrder[0]);
    expect(setProvider.mock.invocationCallOrder[0]).toBeLessThan(validateApiKey.mock.invocationCallOrder[0]);
  });
});
