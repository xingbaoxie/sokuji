import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TranscriptDialog } from './TranscriptDialog';

describe('TranscriptDialog', () => {
  it('copies each segment with its timestamp and speaker prefix', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<TranscriptDialog jobId="rec_1" result={{ segments: [{ id: 'seg-1', startMs: 105600, endMs: 106000, speakerId: 'S01', text: '你好' }] }} onClose={vi.fn()} onExport={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '复制全文' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('[00:01:45.600] [S01] 你好'));
  });

  it('only applies a text search after the field loses focus', () => {
    render(<TranscriptDialog jobId="rec_1" result={{ segments: [
      { id: 'seg-1', startMs: 0, endMs: 1000, speakerId: 'S01', text: '保留内容' },
      { id: 'seg-2', startMs: 1000, endMs: 2000, speakerId: 'S01', text: '目标内容' },
    ] }} onClose={vi.fn()} onExport={vi.fn()} />);

    const search = screen.getByRole('textbox', { name: '搜索内容' });
    fireEvent.change(search, { target: { value: '目标' } });
    expect(screen.getByText('保留内容')).toBeInTheDocument();

    fireEvent.blur(search);
    expect(screen.queryByText('保留内容')).not.toBeInTheDocument();
    expect(screen.getByText('内容')).toBeInTheDocument();
    expect(screen.getByText('目标', { selector: 'mark' })).toBeInTheDocument();
  });

  it('keeps the search field focused when Enter confirms an input method candidate', () => {
    render(<TranscriptDialog jobId="rec_1" result={{ segments: [{ id: 'seg-1', startMs: 0, endMs: 1000, speakerId: 'S01', text: '内容' }] }} onClose={vi.fn()} onExport={vi.fn()} />);
    const search = screen.getByRole('textbox', { name: '搜索内容' });

    search.focus();
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(document.activeElement).toBe(search);
  });

  it('renders the Japanese dialog controls in Japanese', () => {
    render(<TranscriptDialog jobId="rec_1" language="ja" result={{ segments: [] }} onClose={vi.fn()} onExport={vi.fn()} />);
    expect(screen.getByRole('heading', { name: '完全な文字起こし' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '内容を検索' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全文をコピー' })).toBeInTheDocument();
  });
});
