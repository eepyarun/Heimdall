import { fetchAndActivate, getValue } from 'firebase/remote-config';
import { firebase } from './firebase';

export interface AppConfig {
  /** Cloud fallback model for everyday requests. */
  cloudModel: string;
  /** Stronger cloud model used when double-checking an unsure on-device answer. */
  verifyModel: string;
  /** Tried in order when the chosen cloud model is overloaded or out of quota. */
  backupModels: string[];
  /** On-device answers at or below this confidence are double-checked in the cloud (Smart mode). */
  escalateAt: 'low' | 'medium';
  /** Medicine answers are double-checked at this level or below, since mistakes are dangerous. */
  escalateMedicineAt: 'low' | 'medium';
  /** Output languages Gemini Nano can produce on web; anything else is routed to the cloud. */
  onDeviceLanguages: string[];
}

export const DEFAULT_CONFIG: AppConfig = {
  cloudModel: 'gemini-3.5-flash-lite',
  verifyModel: 'gemini-3.8-flash',
  backupModels: ['gemini-3.5-flash', 'gemini-3.5-flash-lite'],
  escalateAt: 'low',
  escalateMedicineAt: 'medium',
  onDeviceLanguages: ['en', 'es', 'ja'],
};

let current: AppConfig = DEFAULT_CONFIG;

export function config(): AppConfig {
  return current;
}

const level = (v: string, fallback: 'low' | 'medium') => (v === 'low' || v === 'medium' ? v : fallback);
const list = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export async function loadConfig(): Promise<AppConfig> {
  const { remoteConfig } = firebase();
  remoteConfig.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 60_000 : 3_600_000;
  remoteConfig.defaultConfig = {
    cloud_model: DEFAULT_CONFIG.cloudModel,
    verify_model: DEFAULT_CONFIG.verifyModel,
    backup_models: DEFAULT_CONFIG.backupModels.join(','),
    escalate_at: DEFAULT_CONFIG.escalateAt,
    escalate_medicine_at: DEFAULT_CONFIG.escalateMedicineAt,
    on_device_languages: DEFAULT_CONFIG.onDeviceLanguages.join(','),
  };
  try {
    await fetchAndActivate(remoteConfig);
  } catch (e) {
    console.warn('Remote Config fetch failed; using cached/default values', e);
  }
  current = {
    cloudModel: getValue(remoteConfig, 'cloud_model').asString() || DEFAULT_CONFIG.cloudModel,
    verifyModel: getValue(remoteConfig, 'verify_model').asString() || DEFAULT_CONFIG.verifyModel,
    backupModels: list(getValue(remoteConfig, 'backup_models').asString()),
    escalateAt: level(getValue(remoteConfig, 'escalate_at').asString(), DEFAULT_CONFIG.escalateAt),
    escalateMedicineAt: level(getValue(remoteConfig, 'escalate_medicine_at').asString(), DEFAULT_CONFIG.escalateMedicineAt),
    onDeviceLanguages: list(getValue(remoteConfig, 'on_device_languages').asString()),
  };
  return current;
}
