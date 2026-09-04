const { EventEmitter } = require('events');
const { RecordingSidecarClient } = require('./recording-sidecar-client');

class FakeSocket extends EventEmitter {
  constructor() { super(); queueMicrotask(() => this.emit('open')); }
  send(raw) { this.sent = JSON.parse(raw); queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ type: 'recording_status_result', id: 1, available: true, message: 'ready' })))); }
  close() { this.closed = true; }
}

describe('recording sidecar client', () => {
  it('sends the main-process token over its private localhost connection', async () => {
    const nativeHost = { start: async () => ({ port: 4567 }), recordingAuth: () => ({ token: 'main-only-token' }) };
    const client = new RecordingSidecarClient(nativeHost, { WebSocketImpl: FakeSocket });
    await expect(client.status()).resolves.toMatchObject({ available: true });
  });
});
