import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => ({
      'recording.title': '录音转写', 'recording.audio.title': '音频文件', 'recording.audio.choose': '选择音频文件',
      'recording.audio.formats': 'M4A、MP3、WAV、AAC 或 FLAC', 'recording.processingScheme': '转写引擎',
      'recording.languagesAndOutput': '转写设置', 'recording.runtimeProfile': '服务设置',
      'recording.sourceMode': '源语言模式', 'recording.sourceLanguage': '源语言', 'recording.targetLanguage': '目标语言',
      'recording.sourceModeOptions.auto': '自动识别', 'recording.sourceModeOptions.mixed': '混合语言', 'recording.sourceModeOptions.fixed': '指定语言',
      'recording.generateTranslation': '生成翻译', 'recording.generateSummary': '生成总结报告',
      'recording.runtimeToken': 'Runtime 令牌', 'recording.saveCredential': '保存', 'recording.removeCredential': '移除',
      'recording.saveAliyunProfile': '保存阿里云设置', 'recording.privateRuntimeHint': '选择转写服务。',
      'recording.aliyun.notConfigured': '阿里云配置尚未保存。', 'recording.status.pending': '检查中',
      'recording.runtimeState.unconfigured': '远端 Runtime 尚未配置。', 'recording.runtimeState.disabled': '服务未启用',
      'recording.runtimeState.unavailable': `服务不可用：${values?.detail ?? ''}`,
      'recording.runtimeState.ready': `服务已就绪 · ${values?.model ?? ''}`,
      'recording.startTranscription': '开始转写', 'recording.jobs': '任务', 'recording.noJobs': '暂无录音任务。',
      'recording.elapsed': `耗时 ${values?.duration ?? ''}`,
    }[key] ?? key),
    i18n: { language: 'zh_CN', resolvedLanguage: 'zh_CN' },
  }),
}));
vi.mock('../../../utils/environment', () => ({ isElectron: () => true }));
vi.mock('../services/recordingService', () => ({
  recordingService: {
    listJobs: vi.fn().mockResolvedValue([]), profileStatus: vi.fn().mockResolvedValue({ credentialConfigured: false, runtimeBaseUrl: '' }),
    privateRuntimeStatus: vi.fn().mockResolvedValue({ state: 'unconfigured' }), aliyunProfileStatus: vi.fn().mockResolvedValue({ configured: false }),
    readArtifact: vi.fn().mockResolvedValue({ fileName: 'report.md', content: '报告正文', truncated: false }),
  },
}));

import RecordingWorkspace, { formatElapsedDuration, formatJobFailure } from './RecordingWorkspace';
import { useRecordingJobStore } from '../stores/recordingJobStore';
import { defaultRecordingJobConfig, type RecordingJobSummary } from '../types/recording';
import { recordingService } from '../services/recordingService';

beforeEach(() => {
  useRecordingJobStore.setState({
    file: null, metadata: null, config: defaultRecordingJobConfig(), jobs: [], loading: false, error: null,
    credentialConfigured: false, runtimeBaseUrl: '', runtimeStatuses: {
      'private-moss': { state: 'ready', engineId: 'moss', modelId: 'MOSS', backend: 'vllm', profileRevision: 'rev-1' },
      'private-funasr': { state: 'disabled', engineId: 'funasr-meeting' },
    }, aliyunProfile: { profileId: 'default', configured: false, region: 'beijing' }, artifactPreview: null,
  });
});

describe('RecordingWorkspace', () => {
  it('keeps the workbench focused on uploading and tasks', () => {
    const { container } = render(<RecordingWorkspace />);
    expect(screen.getByRole('button', { name: '选择音频文件' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '开始转写' })).toBeTruthy();
    expect(screen.queryByText('生成翻译')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).not.toMatch(/模拟|Simulation|POC/);
  });

  it('formats the completed end-to-end duration in the interface language', () => {
    expect(formatElapsedDuration('2026-09-01T00:00:00.000Z', '2026-09-01T00:01:25.000Z', 'zh_CN')).toBe('1分25秒');
    expect(formatElapsedDuration('2026-09-01T00:00:00.000Z', '2026-09-01T01:01:25.000Z', 'en')).toBe('1h 1m 25s');
  });

  it('shows a short user-facing failure instead of the raw provider log', () => {
    expect(formatJobFailure({ code: 'ALIYUN_CLOUD_FAILED', message: "Hostname/IP does not match certificate's altnames" }, 'zh_CN')).toBe('[失败] 对象存储连接失败');
    expect(formatJobFailure({ code: 'ALIYUN_CLOUD_FAILED', message: 'fetch failed' }, 'en')).toBe('[Failed] Cloud service could not read the audio file');
    expect(formatJobFailure(undefined, 'ja')).toBe('[失敗] クラウド文字起こしに失敗しました');
  });

  it('renders an artifact preview inside its own task and marks its file as expanded', () => {
    const config = { ...defaultRecordingJobConfig(), summary: { ...defaultRecordingJobConfig().summary, enabled: true } };
    const job: RecordingJobSummary = {
      jobId: 'job-1', sourceFileName: 'meeting.mp3', sourcePath: '/tmp/meeting.mp3', status: 'completed', config,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:01:00.000Z', completedAt: '2026-09-01T00:01:00.000Z',
      stageRuns: [], artifacts: [{ kind: 'report-markdown', fileName: 'report.md' }],
    };
    useRecordingJobStore.setState({ jobs: [job], artifactPreview: { jobId: job.jobId, fileName: 'report.md', content: '报告正文', truncated: false } });

    const { container } = render(<RecordingWorkspace />);
    const preview = screen.getByText('报告正文');
    expect(preview.closest('li')).toContain(screen.getByText('meeting.mp3'));
    expect(screen.getByRole('button', { name: 'report.md' })).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.recording-section.recording-preview')).toBeNull();
  });

  it('closes the current artifact preview when the same file is clicked again', async () => {
    await useRecordingJobStore.getState().previewArtifact('job-1', 'report.md');
    expect(useRecordingJobStore.getState().artifactPreview?.jobId).toBe('job-1');

    await useRecordingJobStore.getState().previewArtifact('job-1', 'report.md');
    expect(useRecordingJobStore.getState().artifactPreview).toBeNull();
    expect(vi.mocked(recordingService.readArtifact)).toHaveBeenCalledTimes(1);
  });
});
