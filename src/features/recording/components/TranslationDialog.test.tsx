import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TranslationDialog } from './TranslationDialog';

describe('TranslationDialog', () => {
  const result = {
    targetLanguage: 'ja',
    segments: [{ id: 'seg-1', startMs: 105600, endMs: 106000, speakerId: 'S01', text: '你好', translatedText: 'こんにちは' }],
  };

  it('shows the original text stored with the translation', () => {
    render(<TranslationDialog jobId="rec_1" result={result} onClose={vi.fn()} onExport={vi.fn()} />);
    expect(screen.getByText('你好')).toBeInTheDocument();
    expect(screen.getByText('自动识别 → 日本語 · 共 1 段')).toBeInTheDocument();
  });

  it('copies timestamp, speaker, source and translation for every segment', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<TranslationDialog jobId="rec_1" result={result} onClose={vi.fn()} onExport={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '复制全部译文' }));
    const prefix = '[00:01:45.600] [S01] ';
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${prefix}原文：你好\n${' '.repeat(prefix.length)}译文：こんにちは`));
  });

  it('applies search and highlights matches only after blur', () => {
    render(<TranslationDialog jobId="rec_1" result={result} onClose={vi.fn()} onExport={vi.fn()} />);
    const search = screen.getByRole('textbox', { name: '搜索内容' });
    fireEvent.change(search, { target: { value: '你好' } });
    expect(screen.getByText('原文：', { exact: false })).toBeInTheDocument();
    fireEvent.blur(search);
    expect(screen.getByText('你好', { selector: 'mark' })).toBeInTheDocument();
  });

  it('uses English labels for the English interface and copied text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<TranslationDialog jobId="rec_1" result={result} language="en" onClose={vi.fn()} onExport={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Translation result' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search content' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy all translations' }));
    const prefix = '[00:01:45.600] [S01] ';
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${prefix}Original: 你好\n${' '.repeat(prefix.length)}Translation: こんにちは`));
  });
});
