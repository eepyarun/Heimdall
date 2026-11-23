export type DeviceState = 'checking' | 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available' | 'disabled';

interface LanguageModelStatic {
  availability(options?: object): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
}

const SIMULATE_KEY = 'heimdall.simulateNoDevice';

export function getLanguageModel(): LanguageModelStatic | undefined {
  return (globalThis as unknown as { LanguageModel?: LanguageModelStatic }).LanguageModel;
}

/** Demo switch: pretend this browser has no on-device model so the cloud fallback path can be shown. */
export function isDeviceDisabled(): boolean {
  return localStorage.getItem(SIMULATE_KEY) === '1';
}

export function setDeviceDisabled(disabled: boolean) {
  if (disabled) localStorage.setItem(SIMULATE_KEY, '1');
  else localStorage.removeItem(SIMULATE_KEY);
}

export function onDeviceOptions(outputLang = 'en') {
  return {
    expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }],
    expectedOutputs: [{ type: 'text', languages: [outputLang] }],
  } as const;
}

export async function checkDevice(outputLang = 'en'): Promise<DeviceState> {
  if (isDeviceDisabled()) return 'disabled';
  const lm = getLanguageModel();
  if (!lm) return 'unsupported';
  try {
    return await lm.availability(onDeviceOptions(outputLang));
  } catch {
    return 'unavailable';
  }
}

/**
 * The SDK silently routes even ONLY_ON_DEVICE requests to the cloud when the
 * browser has no LanguageModel global, so sensitive steps must gate on this.
 */
export async function canRunPrivately(outputLang = 'en'): Promise<boolean> {
  return (await checkDevice(outputLang)) === 'available';
}
