import { vi } from 'vitest';
import { privateSpeechEngine, RecordingRuntimeClient, validateRuntimeConnection } from './recording-runtime-client.js';

describe('recording Runtime client', () => {
  it('keeps the token in the main-process request object only', async () => {
    const request = vi.fn().mockResolvedValue({ speech: {} });
    const client = new RecordingRuntimeClient({ baseUrl: 'https://runtime.internal/', token: 'main-secret', request });
    await expect(client.capabilities()).resolves.toEqual({ speech: {} });
    expect(request).toHaveBeenCalledWith({ method: 'GET', requestPath: '/v1/capabilities', body: undefined, token: 'main-secret' });
  });

  it('uses the Runtime health endpoint for a lightweight readiness check', async () => {
    const request = vi.fn().mockResolvedValue({ status: 'ok' });
    const client = new RecordingRuntimeClient({ baseUrl: 'https://runtime.internal/', token: 'main-secret', request });
    await expect(client.health()).resolves.toEqual({ status: 'ok' });
    expect(request).toHaveBeenCalledWith({ method: 'GET', requestPath: '/v1/health', body: undefined, token: 'main-secret' });
  });

  it('rejects an endpoint with an embedded credential', () => {
    expect(() => validateRuntimeConnection('https://secret@runtime.internal', 'token')).toThrow(/credentialed/i);
  });

  it('maps each private speech selection to its fixed Runtime engine', () => {
    expect(privateSpeechEngine({ speech: { providerId: 'private-runtime', engineId: 'moss' } })).toBe('moss');
    expect(privateSpeechEngine({ speech: { providerId: 'private-runtime', engineId: 'funasr-meeting' } })).toBe('funasr-meeting');
  });

  it('wraps text-stage data in the Control API payload contract', async () => {
    const request = vi.fn().mockResolvedValue({ taskId: 'summary_1' });
    const client = new RecordingRuntimeClient({ baseUrl: 'https://runtime.internal/', token: 'main-secret', request });
    await client.submit('summary', { profileRevision: 'r1', modelId: 'local-summary', inputMode: 'bilingual', segments: [{ id: 'seg-1', text: 'hello' }] });
    expect(request).toHaveBeenCalledWith({
      method: 'POST', requestPath: '/v1/summary/tasks', token: 'main-secret',
      body: { profileRevision: 'r1', modelId: 'local-summary', payload: { inputMode: 'bilingual', segments: [{ id: 'seg-1', text: 'hello' }] } },
    });
  });
});
