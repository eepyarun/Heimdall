import type { Category, Confidence, Mode, Privacy } from '../types';

/** Same string values as the SDK's InferenceMode, kept local so this module stays SDK-free and testable. */
export type RouteMode = 'prefer_on_device' | 'only_on_device' | 'prefer_in_cloud' | 'only_in_cloud';

export interface Route {
  mode: RouteMode;
  why: string;
}

export interface PolicyInput {
  mode: Mode;
  privacy: Privacy;
  lang: string;
  deviceReady: boolean;
  onDeviceLanguages: string[];
  languageName: string;
}

export class PrivateModeUnavailable extends Error {
  constructor() {
    super('Private mode needs on-device AI, and it is not available on this device. Switch to Smart mode to use the cloud.');
  }
}

export function chooseRoute(p: PolicyInput): Route {
  if (p.privacy === 'private') {
    // The SDK sends ONLY_ON_DEVICE requests to the cloud when the browser has no
    // LanguageModel at all, so Private mode must refuse instead of calling it.
    if (!p.deviceReady) throw new PrivateModeUnavailable();
    return { mode: 'only_on_device', why: 'Private mode: photos never leave this device' };
  }
  if (p.privacy === 'quality') {
    return { mode: 'prefer_in_cloud', why: 'Best-quality mode: cloud first, on-device if offline' };
  }
  if (!p.onDeviceLanguages.includes(p.lang)) {
    return { mode: 'prefer_in_cloud', why: `${p.languageName} isn't supported by on-device AI yet` };
  }
  if (!p.deviceReady) {
    return { mode: 'prefer_on_device', why: 'On-device AI not available here, so the cloud answers' };
  }
  return { mode: 'prefer_on_device', why: 'On-device first: private, free, works offline' };
}

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export function isAtOrBelow(c: Confidence, threshold: Confidence) {
  return RANK[c] <= RANK[threshold];
}

export interface EscalationInput {
  privacy: Privacy;
  answeredOnDevice: boolean;
  confidence: Confidence;
  category?: Category;
  escalateAt: Confidence;
  escalateMedicineAt: Confidence;
}

/** Smart mode double-checks unsure on-device answers in the cloud; medicine uses a stricter bar. */
export function shouldEscalate(e: EscalationInput): boolean {
  if (e.privacy !== 'smart' || !e.answeredOnDevice) return false;
  const threshold = e.category === 'medicine' ? e.escalateMedicineAt : e.escalateAt;
  return isAtOrBelow(e.confidence, threshold);
}

export function normalizeConfidence(v: unknown): Confidence {
  return v === 'high' || v === 'medium' || v === 'low' ? v : 'low';
}

/** Errors worth retrying on another cloud model: overload, quota, or a retired model name. */
export function isBusyError(e: unknown): boolean {
  return /high demand|overloaded|unavailable|quota|resource.?exhausted|no longer available|not found for API|\b(429|500|502|503|504)\b/i.test(String(e));
}

/** Try the chosen model twice (overload spikes are brief), then each other model once. */
export function modelChain(primary: string, others: string[]): string[] {
  return [primary, ...new Set([primary, ...others.filter(Boolean)])];
}
