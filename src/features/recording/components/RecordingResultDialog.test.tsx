import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecordingResultDialog } from './RecordingResultDialog';

describe('RecordingResultDialog', () => {
  it('does not bubble result interactions to the task card', () => {
    const onTaskCardClick = vi.fn();
    render(<div onClick={onTaskCardClick}><RecordingResultDialog title="翻译结果" onClose={vi.fn()}><button type="button">播放此段</button></RecordingResultDialog></div>);
    fireEvent.click(screen.getByRole('button', { name: '播放此段' }));
    expect(onTaskCardClick).not.toHaveBeenCalled();
  });
});
