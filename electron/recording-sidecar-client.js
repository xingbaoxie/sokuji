const WebSocket = require('ws');

class RecordingSidecarClient {
  constructor(nativeHost, { WebSocketImpl = WebSocket, timeoutMs = 5000 } = {}) {
    this.nativeHost = nativeHost;
    this.WebSocketImpl = WebSocketImpl;
    this.timeoutMs = timeoutMs;
  }

  async status() {
    const { port } = await this.nativeHost.start();
    const { token } = this.nativeHost.recordingAuth();
    return new Promise((resolve, reject) => {
      const socket = new this.WebSocketImpl(`ws://127.0.0.1:${port}`);
      const timer = setTimeout(() => {
        try { socket.close(); } catch (_) { /* no-op */ }
        reject(new Error('Recording sidecar status request timed out.'));
      }, this.timeoutMs);
      socket.once('error', () => { clearTimeout(timer); reject(new Error('Recording sidecar connection failed.')); });
      socket.once('open', () => socket.send(JSON.stringify({ type: 'recording_status', id: 1, token })));
      socket.on('message', (raw) => {
        let reply;
        try { reply = JSON.parse(raw.toString()); } catch { return; }
        if (reply.id !== 1) return;
        clearTimeout(timer);
        socket.close();
        if (reply.type === 'error') reject(new Error(reply.message));
        else resolve(reply);
      });
    });
  }
}

module.exports = { RecordingSidecarClient };
