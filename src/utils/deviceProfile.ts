import { checkWebGPU } from './webgpu';

/**
 * The machine facts a support case needs and telemetry could not answer before:
 * which GPU answered, whether it offers `shader-f16`, and which OS build this
 * is. Reported once per launch on `app_startup`, and mirrored onto the person
 * so one lookup answers "what is this user running".
 *
 * Every field is optional-by-absence rather than empty-by-default: a missing
 * key means "we could not find out", which is different from a false or an ''.
 */
export interface DeviceProfile {
  webgpu_available: boolean;
  webgpu_software_only: boolean;
  webgpu_shader_f16: boolean;
  gpu_vendor?: string;
  gpu_architecture?: string;
  gpu_device?: string;
  gpu_description?: string;
  /** Raw OS version string, as the platform words it. */
  os_version?: string;
  /** Friendly name, only where the mapping is unambiguous. */
  os_name?: string;
}

/**
 * How long the probe gets before the launch is reported without it.
 * `requestAdapter()` is not guaranteed to settle -- a wedged GPU driver is
 * exactly the condition this telemetry exists to catch, so it must not be the
 * condition that silences it. Before this event carried a profile it was sent
 * unconditionally on mount, and that reliability is worth keeping.
 */
const PROBE_TIMEOUT_MS = 5000;

/** Windows 11's first build. Below it, the same "10.0" major means Windows 10. */
const WINDOWS_11_MIN_BUILD = 22000;

/**
 * UA-CH reports Windows as its own version line, not the NT one: 1-12 is
 * Windows 10, 13 and up is Windows 11.
 * https://learn.microsoft.com/microsoft-edge/web-platform/how-to-detect-win11
 */
const UA_CH_WINDOWS_11_MIN_MAJOR = 13;

type OsFields = Pick<DeviceProfile, 'os_version' | 'os_name'>;

/**
 * Static host facts the Electron preload exposes off its own `process`. Absent
 * in the extension and on the web, which is how the two paths tell themselves
 * apart -- we ask for the bridge we need, not for the platform.
 */
function hostOsInfo(): { platform?: string; systemVersion?: string } | null {
  const info = (globalThis as any).window?.electron?.osInfo;
  return info && typeof info === 'object' ? info : null;
}

function nameWindowsBuild(systemVersion: string): string | undefined {
  // "10.0.26100" -> 26100
  const build = Number(systemVersion.split('.')[2]);
  if (!Number.isFinite(build)) return undefined;
  return build >= WINDOWS_11_MIN_BUILD ? 'Windows 11' : 'Windows 10';
}

/**
 * Both routes report a readable macOS product version, so naming it is the same
 * job on either side -- shared so the two cannot drift apart. The strings differ
 * in precision (`getSystemVersion()` says "15.0", UA-CH says "15.0.0") and that
 * is left alone on purpose: os_version carries the exact value for grouping, and
 * inventing a normaliser for a human-readable label would only add a way to be
 * wrong about a point release.
 */
function nameMacOs(version: string): string {
  return `macOS ${version}`;
}

function nameHostOs(platform: string | undefined, systemVersion: string): string | undefined {
  if (platform === 'win32') return nameWindowsBuild(systemVersion);
  if (platform === 'darwin') return nameMacOs(systemVersion);
  // On Linux getSystemVersion() is the kernel release; naming a distro from it
  // would be invention, so the raw version stands on its own.
  return undefined;
}

function nameUaChWindows(platformVersion: string): string | undefined {
  const major = Number(platformVersion.split('.')[0]);
  if (!Number.isFinite(major)) return undefined;
  return major >= UA_CH_WINDOWS_11_MIN_MAJOR ? 'Windows 11' : 'Windows 10';
}

/**
 * The browser counterpart of nameHostOs, down to which platforms stay unnamed.
 * A macOS user on the extension must not land in a different bucket from the
 * same user on the desktop app.
 */
function nameUaChOs(platform: string | undefined, platformVersion: string): string | undefined {
  if (platform === 'Windows') return nameUaChWindows(platformVersion);
  if (platform === 'macOS') return nameMacOs(platformVersion);
  return undefined;
}

function osFields(version: string, name: string | undefined): OsFields {
  return name ? { os_version: version, os_name: name } : { os_version: version };
}

async function readOs(): Promise<OsFields> {
  // Electron: navigator.userAgentData is undefined and navigator.userAgent is
  // our own overridden string, so the preload bridge is the only route here.
  const host = hostOsInfo();
  if (typeof host?.systemVersion === 'string' && host.systemVersion !== '') {
    return osFields(host.systemVersion, nameHostOs(host.platform, host.systemVersion));
  }

  // Extension / web: Windows 10 and 11 both send "Windows NT 10.0" in the UA
  // string, so UA-CH is the only place the split shows up.
  try {
    const uaData = (navigator as any).userAgentData;
    const version = uaData?.getHighEntropyValues
      ? (await uaData.getHighEntropyValues(['platformVersion']))?.platformVersion
      : undefined;
    if (typeof version === 'string' && version !== '') {
      return osFields(version, nameUaChOs(uaData.platform, version));
    }
  } catch {
    // UA-CH missing or refused: the version is simply unknown, which is a
    // reportable state, not an error worth surfacing.
  }
  return {};
}

/**
 * Resolves to `{}` rather than hanging when the probe does not settle. An empty
 * profile reads the same as one that found nothing: absence means "we could not
 * find out", so no caller needs a separate timeout case.
 */
export function collectDeviceProfile(timeoutMs = PROBE_TIMEOUT_MS): Promise<Partial<DeviceProfile>> {
  return Promise.race([
    buildProfile(),
    new Promise<Partial<DeviceProfile>>(resolve => setTimeout(() => resolve({}), timeoutMs)),
  ]);
}

async function buildProfile(): Promise<DeviceProfile> {
  const [gpu, os] = await Promise.all([checkWebGPU(), readOs()]);
  const adapter = gpu.adapterInfo ?? {};
  return {
    webgpu_available: gpu.available,
    webgpu_software_only: gpu.softwareOnly,
    webgpu_shader_f16: gpu.features.includes('shader-f16'),
    ...(adapter.vendor ? { gpu_vendor: adapter.vendor } : {}),
    ...(adapter.architecture ? { gpu_architecture: adapter.architecture } : {}),
    ...(adapter.device ? { gpu_device: adapter.device } : {}),
    ...(adapter.description ? { gpu_description: adapter.description } : {}),
    ...os,
  };
}
