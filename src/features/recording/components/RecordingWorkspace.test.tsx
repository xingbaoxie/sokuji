import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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
      'recording.deleteJob': `删除任务 ${values?.fileName ?? ''}`,
      'recording.deleteJobConfirm': `删除任务“${values?.fileName ?? ''}”？`,
      'recording.deleteJobDetails': '将删除本地任务记录与导出文件，原始音频文件不会被删除。',
      'recording.deleteJobCloudWarning': '云端临时文件可能仍保留，直至服务端清理策略执行。',
    }[key] ?? key),
    // During lazy catalog loading, i18next may still report the English
    // fallback as resolvedLanguage although the selected UI language is Chinese.
    i18n: { language: 'zh_CN', resolvedLanguage: 'en' },
  }),
}));
vi.mock('../../../utils/environment', () => ({ isElectron: () => true }));
vi.mock('../services/recordingService', () => ({
  recordingService: {
    listJobs: vi.fn().mockResolvedValue([]), profileStatus: vi.fn().mockResolvedValue({ credentialConfigured: false, runtimeBaseUrl: '' }),
    privateRuntimeStatus: vi.fn().mockResolvedValue({ state: 'unconfigured' }), aliyunProfileStatus: vi.fn().mockResolvedValue({ configured: false }),
    readArtifact: vi.fn().mockResolvedValue({ fileName: 'report.md', content: '报告正文', truncated: false }), deleteJob: vi.fn(),
  },
}));

import RecordingWorkspace, { displayRecordingModelName, formatElapsedDuration, formatJobFailure } from './RecordingWorkspace';
import { useRecordingJobStore } from '../stores/recordingJobStore';
import { defaultRecordingJobConfig, type RecordingJobSummary } from '../types/recording';
import { recordingService } from '../services/recordingService';

beforeEach(() => {
  useRecordingJobStore.setState({
    file: null, config: defaultRecordingJobConfig(), jobs: [], loading: false, error: null,
    credentialConfigured: false, runtimeBaseUrl: '', runtimeStatuses: {
      'private-moss': { state: 'ready', engineId: 'moss', modelId: 'MOSS', backend: 'vllm', profileRevision: 'rev-1' },
      'private-funasr': { state: 'disabled', engineId: 'funasr-meeting' },
    }, aliyunProfile: { profileId: 'default', configured: false, region: 'beijing' }, artifactPreview: null,
  });
});

afterEach(() => vi.restoreAllMocks());

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

  it('shows a compact model name while retaining the full model id for its hint', () => {
    expect(displayRecordingModelName('OpenMOSS-Team/MOSS-Transcribe-Diarize')).toBe('MOSS-Transcribe-Diarize');
    expect(displayRecordingModelName('qwen-audio-3.0-asr-flash-filetrans')).toBe('qwen-audio-3.0-asr-flash-filetrans');
    expect(displayRecordingModelName()).toBe('');
  });

  it('shows a short user-facing failure instead of the raw provider log', () => {
    expect(formatJobFailure({ code: 'ALIYUN_CLOUD_FAILED', message: "Hostname/IP does not match certificate's altnames" }, 'zh_CN')).toBe('[失败] 对象存储连接失败');
    expect(formatJobFailure({ code: 'AUDIO_UNREADABLE', message: 'hidden internal details' }, 'zh_CN')).toBe('[失败] 远端无法读取音频文件');
    expect(formatJobFailure({ code: 'AUDIO_DURATION_EXCEEDED', message: 'hidden internal details' }, 'en')).toBe('[Failed] Audio duration exceeds the service limit');
    expect(formatJobFailure({ code: 'PRIVATE_RUNTIME_FAILED', message: 'hidden internal details' }, 'zh_CN')).toBe('[失败] 远端转写失败');
    expect(formatJobFailure({ code: 'ALIYUN_CLOUD_FAILED', message: 'fetch failed' }, 'en')).toBe('[Failed] Cloud service could not read the audio file');
    expect(formatJobFailure(undefined, 'ja')).toBe('[失敗] クラウド文字起こしに失敗しました');
  });

  it('keeps technical artifacts out of a completed task until a user result preview exists', () => {
    const config = { ...defaultRecordingJobConfig(), summary: { ...defaultRecordingJobConfig().summary, enabled: true } };
    const job: RecordingJobSummary = {
      jobId: 'job-1', sourceFileName: 'meeting.mp3', status: 'completed', config,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:01:00.000Z', completedAt: '2026-09-01T00:01:00.000Z',
      stageRuns: [], artifacts: [{ kind: 'report-markdown', fileName: 'report.md' }],
    };
    useRecordingJobStore.setState({ jobs: [job] });

    const { container } = render(<RecordingWorkspace />);
    expect(screen.getByText('meeting.mp3')).toBeTruthy();
    expect(screen.queryByText('report.md')).toBeNull();
    expect(container.querySelector('.recording-section.recording-preview')).toBeNull();
  });

  it('expands and collapses a result task when its card is clicked', () => {
    const config = defaultRecordingJobConfig();
    const job: RecordingJobSummary = {
      jobId: 'job-expand', sourceFileName: 'meeting.mp3', status: 'completed', config,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:01:00.000Z', completedAt: '2026-09-01T00:01:00.000Z',
      stageRuns: [], artifacts: [{ kind: 'transcript-json', fileName: 'transcript.json' }],
    };
    useRecordingJobStore.setState({ jobs: [job] });
    render(<RecordingWorkspace />);
    const card = screen.getByText('meeting.mp3').closest('li') as HTMLElement;
    fireEvent.click(card);
    expect(card).toHaveClass('is-expanded');
    fireEvent.click(card);
    expect(card).not.toHaveClass('is-expanded');
  });

  it('groups summary generation and report formatting into one user-facing stage', () => {
    const config = { ...defaultRecordingJobConfig(), summary: { ...defaultRecordingJobConfig().summary, enabled: true } };
    const job: RecordingJobSummary = {
      jobId: 'job-summary', sourceFileName: 'meeting.mp3', status: 'completed', config,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:01:00.000Z', completedAt: '2026-09-01T00:01:00.000Z',
      stageRuns: [{ stage: 'summary.execute', status: 'completed', progress: 100 }, { stage: 'report.build', status: 'completed', progress: 100 }], artifacts: [],
    };
    useRecordingJobStore.setState({ jobs: [job] });
    render(<RecordingWorkspace />);
    expect(screen.getByText('总结报告 已完成')).toBeInTheDocument();
    expect(screen.queryByText('报告 已完成')).toBeNull();
  });

  it('polls only while a task is active, at a restrained interval', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const config = defaultRecordingJobConfig();
    const completed: RecordingJobSummary = { jobId: 'job-completed', sourceFileName: 'done.mp3', status: 'completed', config, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:01:00.000Z', stageRuns: [], artifacts: [] };
    useRecordingJobStore.setState({ jobs: [completed] });
    const { unmount } = render(<RecordingWorkspace />);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    unmount();

    const active: RecordingJobSummary = { ...completed, jobId: 'job-running', sourceFileName: 'running.mp3', status: 'running' };
    useRecordingJobStore.setState({ jobs: [active] });
    render(<RecordingWorkspace />);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 3000);
  });

  it('closes the current artifact preview when the same file is clicked again', async () => {
    await useRecordingJobStore.getState().previewArtifact('job-1', 'report.md');
    expect(useRecordingJobStore.getState().artifactPreview?.jobId).toBe('job-1');

    await useRecordingJobStore.getState().previewArtifact('job-1', 'report.md');
    expect(useRecordingJobStore.getState().artifactPreview).toBeNull();
    expect(vi.mocked(recordingService.readArtifact)).toHaveBeenCalledTimes(1);
  });

  it('shows deletion only for a terminal task and clears its local row after confirmation', async () => {
    const config = defaultRecordingJobConfig();
    const job: RecordingJobSummary = {
      jobId: 'job-delete', sourceFileName: 'meeting.mp3', status: 'failed', config,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:01:00.000Z', stageRuns: [], artifacts: [],
    };
    vi.mocked(recordingService.listJobs).mockResolvedValue([job]);
    vi.mocked(recordingService.deleteJob).mockResolvedValue({ jobId: job.jobId });
    useRecordingJobStore.setState({ jobs: [job] });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<RecordingWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: '删除任务 meeting.mp3' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('原始音频文件不会被删除'));
    await waitFor(() => expect(recordingService.deleteJob).toHaveBeenCalledWith(job.jobId));
    await waitFor(() => expect(screen.queryByText('meeting.mp3')).toBeNull());
  });
});
