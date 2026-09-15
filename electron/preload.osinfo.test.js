import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INVOKE_CHANNELS, EXTERNAL_INVOKE_CHANNELS, BRIDGE_ONLY_CHANNELS } from './ipc-channels.js';

// The renderer's device telemetry needs the OS version, and in Electron there
// is no other route to it: navigator.userAgentData is undefined and
// navigator.userAgent is overridden in main.js. Measured on Electron 40.8.5
// with this app's webPreferences (sandbox on): require('os') throws
// "module not found: os", but process.getSystemVersion() is in the sandboxed
// preload's process polyfill.
describe('the osInfo bridge', () => {
  const src = readFileSync(join(__dirname, 'preload.js'), 'utf8');

  it('exposes platform, arch and the system version off the preload process', () => {
    expect(src).toContain('osInfo:');
    expect(src).toContain('platform: process.platform');
    expect(src).toContain('arch: process.arch');
    expect(src).toContain('systemVersion: process.getSystemVersion()');
  });

  it('costs no IPC channel, since the values are static host facts', () => {
    const all = [...INVOKE_CHANNELS, ...EXTERNAL_INVOKE_CHANNELS, ...BRIDGE_ONLY_CHANNELS];
    expect(all.filter(channel => /os[-:]?info/i.test(channel))).toEqual([]);
  });
});
