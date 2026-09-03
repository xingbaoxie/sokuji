import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh_CN' } }),
}));

const { service } = vi.hoisted(() => ({ service: {
  processingSettings: vi.fn(), providerCatalog: vi.fn(), profileStatus: vi.fn(), aliyunProfileStatus: vi.fn(), providerStatus: vi.fn(),
  saveProcessingSettings: vi.fn(), saveProfileCredential: vi.fn(), saveAliyunProfile: vi.fn(),
} }));
vi.mock('../services/recordingService', () => ({ recordingService: service }));

import RecordingSettingsSection from './RecordingSettingsSection';
import { defaultRecordingJobConfig } from '../types/recording';

const catalog = {
  providers: [
    { id: 'private-runtime', labelKey: 'private', stages: ['speech', 'translation', 'summary'], speechOptions: [] },
    { id: 'aliyun-cloud', labelKey: 'aliyun', stages: ['speech', 'translation', 'summary'], speechOptions: [] },
  ],
  connections: [
    { id: 'speech.private-moss', providerId: 'private-runtime', stage: 'speech', labelKey: 'mossRuntime' },
    { id: 'speech.private-funasr', providerId: 'private-runtime', stage: 'speech', labelKey: 'funasrRuntime' },
    { id: 'speech.aliyun', providerId: 'aliyun-cloud', stage: 'speech', labelKey: 'aliyunSpeech' },
  ],
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  service.processingSettings.mockResolvedValue(defaultRecordingJobConfig());
  service.providerCatalog.mockResolvedValue(catalog);
  service.profileStatus.mockResolvedValue({ credentialConfigured: false, runtimeBaseUrl: '' });
  service.aliyunProfileStatus.mockResolvedValue({ configured: false, region: 'beijing' });
  service.providerStatus.mockResolvedValue({ state: 'unconfigured' });
  service.saveProcessingSettings.mockImplementation(async (config) => config);
});

describe('RecordingSettingsSection', () => {
  it('shows the provider and connection without duplicating the transcription scheme', async () => {
    render(<RecordingSettingsSection />);
    await screen.findByText('recording.transcriptionService');
    const selects = screen.getAllByRole('combobox');
    expect(selects[0]).toHaveValue('private-runtime');
    expect(selects[1]).toHaveValue('speech.private-moss');
    selects.forEach((select) => expect(select.className).toContain('select-dropdown'));
    expect(screen.queryByText('recording.transcriptionOption')).toBeNull();
  });

  it('switches to the fixed Aliyun Filetrans option without exposing a private engine selector', async () => {
    render(<RecordingSettingsSection />);
    const [provider] = await screen.findAllByRole('combobox');
    fireEvent.change(provider, { target: { value: 'aliyun-cloud' } });
    await waitFor(() => expect(service.saveProcessingSettings).toHaveBeenCalled());
    expect(screen.getByText('recording.connection.speech_aliyun')).toBeTruthy();
    expect(screen.queryByText('recording.connection.speech_private_moss')).toBeNull();
  });

  it('separates Bailian model service fields from OSS storage fields', async () => {
    render(<RecordingSettingsSection />);
    const [provider] = await screen.findAllByRole('combobox');
    fireEvent.change(provider, { target: { value: 'aliyun-cloud' } });
    await screen.findByText('百炼模型服务');
    expect(screen.getByText('OSS 对象存储')).toBeTruthy();
    expect(screen.getByDisplayValue('qwen-audio-3.0-asr-flash-filetrans')).toBeTruthy();
  });

  it('shows an Aliyun summary model only in its service configuration card', async () => {
    service.processingSettings.mockResolvedValue({ ...defaultRecordingJobConfig(), summary: { ...defaultRecordingJobConfig().summary, enabled: true } });
    render(<RecordingSettingsSection />);
    await screen.findByText('recording.connection.summary_aliyun');
    expect(screen.getAllByDisplayValue('qwen3.8-max')).toHaveLength(1);
  });

});
