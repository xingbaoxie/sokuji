import { describe, expect, it } from 'vitest';
import { contentRange } from './recording-audio-protocol.js';

describe('recording audio range protocol', () => {
  it('parses valid byte ranges and rejects invalid ranges', () => {
    expect(contentRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19, partial: true });
    expect(contentRange('bytes=90-', 100)).toEqual({ start: 90, end: 99, partial: true });
    expect(contentRange('bytes=-10', 100)).toEqual({ start: 90, end: 99, partial: true });
    expect(contentRange('bytes=100-101', 100)).toBeNull();
  });
});
