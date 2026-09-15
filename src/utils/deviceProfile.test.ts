import { describe, it, expect, vi, afterEach } from 'vitest';

// The module under test reads a cached WebGPU probe, so every case needs a
// fresh module graph.
async function loadModule() {
  vi.resetModules();
  return import('./deviceProfile');
}

/** A browser (extension or web): no preload bridge, so UA-CH is all there is. */
function stubBrowser(navigatorOverrides: Record<string, any> = {}) {
  vi.stubGlobal('navigator', { userAgent: '', ...navigatorOverrides });
  vi.stubGlobal('window', {});
}

/** An Electron renderer: the preload bridge answers, UA-CH does not exist. */
function stubElectron(osInfo: Record<string, string>) {
  vi.stubGlobal('navigator', { userAgent: 'Sokuji/0.40.2 Electron/40.8.5 (Windows)' });
  vi.stubGlobal('window', { electron: { osInfo } });
}

afterEach(() => vi.unstubAllGlobals());

describe('collectDeviceProfile — GPU', () => {
  it('reports the adapter identity and shader-f16 support', async () => {
    stubBrowser({
      gpu: {
        requestAdapter: () => Promise.resolve({
          features: new Set(['shader-f16']),
          info: { vendor: 'nvidia', architecture: 'ada-lovelace', device: '', description: 'NVIDIA GeForce RTX 4070 SUPER' },
        }),
      },
    });
    const { collectDeviceProfile } = await loadModule();
    const profile = await collectDeviceProfile();
    expect(profile).toMatchObject({
      webgpu_available: true,
      webgpu_software_only: false,
      webgpu_shader_f16: true,
      gpu_vendor: 'nvidia',
      gpu_architecture: 'ada-lovelace',
      gpu_description: 'NVIDIA GeForce RTX 4070 SUPER',
    });
    // Empty adapter strings are omitted rather than reported as ''.
    expect('gpu_device' in profile).toBe(false);
  });

  it('reports shader-f16 as false when the adapter lacks it', async () => {
    stubBrowser({
      gpu: { requestAdapter: () => Promise.resolve({ features: new Set(), info: { vendor: 'intel' } }) },
    });
    const { collectDeviceProfile } = await loadModule();
    expect(await collectDeviceProfile()).toMatchObject({
      webgpu_available: true,
      webgpu_shader_f16: false,
      gpu_vendor: 'intel',
    });
  });

  it('flags a CPU rasteriser, which is one way f16 goes missing', async () => {
    stubBrowser({
      gpu: {
        requestAdapter: () => Promise.resolve({
          features: new Set(),
          info: { vendor: 'google', architecture: 'swiftshader' },
        }),
      },
    });
    const { collectDeviceProfile } = await loadModule();
    expect(await collectDeviceProfile()).toMatchObject({
      webgpu_available: true,
      webgpu_software_only: true,
      webgpu_shader_f16: false,
    });
  });

  it('reports WebGPU as absent instead of throwing when navigator.gpu is missing', async () => {
    stubBrowser();
    const { collectDeviceProfile } = await loadModule();
    expect(await collectDeviceProfile()).toMatchObject({
      webgpu_available: false,
      webgpu_software_only: false,
      webgpu_shader_f16: false,
    });
  });
});

describe('collectDeviceProfile — the probe cannot silence the event', () => {
  it('gives up and resolves empty when requestAdapter never settles', async () => {
    vi.useFakeTimers();
    try {
      // A wedged GPU driver is the condition this telemetry exists to catch, so
      // it must not be the condition that stops the launch being reported.
      stubBrowser({ gpu: { requestAdapter: () => new Promise(() => {}) } });
      const { collectDeviceProfile } = await loadModule();
      const pending = collectDeviceProfile(5000);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await pending).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wait out the timeout when the probe answers', async () => {
    vi.useFakeTimers();
    try {
      stubBrowser({ gpu: { requestAdapter: () => Promise.resolve({ features: new Set() }) } });
      const { collectDeviceProfile } = await loadModule();
      // No timer advance: a resolved probe must win the race on its own.
      expect(await collectDeviceProfile(5000)).toMatchObject({ webgpu_available: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('collectDeviceProfile — OS version in Electron', () => {
  // Measured on Electron 40.8.5: navigator.userAgentData is undefined and
  // require('os') throws in the sandboxed preload, so process.getSystemVersion()
  // exposed over contextBridge is the desktop app's only route to this.
  it('reads the OS version off the preload bridge and names the Windows release', async () => {
    stubElectron({ platform: 'win32', systemVersion: '10.0.26100', arch: 'x64' });
    const { collectDeviceProfile } = await loadModule();
    expect(await collectDeviceProfile()).toMatchObject({
      os_version: '10.0.26100',
      os_name: 'Windows 11',
    });
  });

  it('names a Windows build below 22000 Windows 10', async () => {
    stubElectron({ platform: 'win32', systemVersion: '10.0.19045', arch: 'x64' });
    const { collectDeviceProfile } = await loadModule();
    expect(await collectDeviceProfile()).toMatchObject({ os_version: '10.0.19045', os_name: 'Windows 10' });
  });

  it('names the macOS release from the product version', async () => {
    stubElectron({ platform: 'darwin', systemVersion: '15.0', arch: 'arm64' });
    const { collectDeviceProfile } = await loadModule();
    expect(await collectDeviceProfile()).toMatchObject({ os_version: '15.0', os_name: 'macOS 15.0' });
  });

  it('leaves the Linux kernel release unnamed rather than inventing a distro', async () => {
    stubElectron({ platform: 'linux', systemVersion: '6.17.0-1026-nvidia', arch: 'arm64' });
    const profile = await (await loadModule()).collectDeviceProfile();
    expect(profile.os_version).toBe('6.17.0-1026-nvidia');
    expect('os_name' in profile).toBe(false);
  });

  it('falls through rather than throwing when the bridge exposes no version', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Sokuji/0.40.2 Electron/40.8.5 (Windows)' });
    vi.stubGlobal('window', { electron: {} });   // older build, no osInfo
    const profile = await (await loadModule()).collectDeviceProfile();
    expect(profile.webgpu_available).toBe(false);
    expect('os_version' in profile).toBe(false);
  });
});

describe('collectDeviceProfile — OS version outside Electron', () => {
  // Windows 10 and 11 both send "Windows NT 10.0" in the UA string; the UA-CH
  // platformVersion is the only place the split is visible.
  it('splits Windows 10 from 11 by the UA-CH platform version', async () => {
    stubBrowser({
      userAgentData: {
        platform: 'Windows',
        getHighEntropyValues: () => Promise.resolve({ platformVersion: '15.0.0' }),
      },
    });
    const { collectDeviceProfile } = await loadModule();
    expect(await collectDeviceProfile()).toMatchObject({ os_version: '15.0.0', os_name: 'Windows 11' });
  });

  it('maps a platform version below 13 to Windows 10', async () => {
    stubBrowser({
      userAgentData: {
        platform: 'Windows',
        getHighEntropyValues: () => Promise.resolve({ platformVersion: '10.0.0' }),
      },
    });
    const { collectDeviceProfile } = await loadModule();
    expect(await collectDeviceProfile()).toMatchObject({ os_version: '10.0.0', os_name: 'Windows 10' });
  });

  // A macOS user on the extension must not land in a different bucket from the
  // same user on the desktop app, which names macOS from the Electron bridge.
  it('names macOS from the UA-CH platform version too', async () => {
    stubBrowser({
      userAgentData: {
        platform: 'macOS',
        getHighEntropyValues: () => Promise.resolve({ platformVersion: '15.0.0' }),
      },
    });
    const { collectDeviceProfile } = await loadModule();
    expect(await collectDeviceProfile()).toMatchObject({ os_version: '15.0.0', os_name: 'macOS 15.0.0' });
  });

  it('leaves a platform it has no unambiguous name for unnamed', async () => {
    stubBrowser({
      userAgentData: {
        platform: 'Linux',
        getHighEntropyValues: () => Promise.resolve({ platformVersion: '6.17.0' }),
      },
    });
    const profile = await (await loadModule()).collectDeviceProfile();
    expect(profile.os_version).toBe('6.17.0');
    expect('os_name' in profile).toBe(false);
  });

  it('omits the OS version when UA-CH is unavailable', async () => {
    stubBrowser();
    const profile = await (await loadModule()).collectDeviceProfile();
    expect('os_version' in profile).toBe(false);
    expect('os_name' in profile).toBe(false);
  });
});
