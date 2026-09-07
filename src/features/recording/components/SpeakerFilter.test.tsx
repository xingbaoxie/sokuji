import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SpeakerFilter } from './SpeakerFilter';

describe('SpeakerFilter', () => {
  it('uses compact toggle chips and lets All reset the selection', () => {
    const onChange = vi.fn();
    render(<SpeakerFilter speakers={['S01', 'S02']} selected={['S01']} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'S01' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'S02' }));
    expect(onChange).toHaveBeenLastCalledWith(['S01', 'S02']);
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('uses the selected Japanese or English interface language', () => {
    const { rerender } = render(<SpeakerFilter speakers={[]} selected={[]} onChange={vi.fn()} language="ja" />);
    expect(screen.getByText('話者')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'すべて' })).toBeInTheDocument();
    rerender(<SpeakerFilter speakers={[]} selected={[]} onChange={vi.fn()} language="en" />);
    expect(screen.getByText('Speaker')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
  });
});
