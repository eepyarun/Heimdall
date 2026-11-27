/**
 * Bridge to the Android app (android/). The Android app shows this same web UI in a WebView and
 * exposes `window.HeimdallAndroid`, so that on Android:
 * - AI calls go through the native Firebase AI Logic SDK, which runs Gemini Nano on-device through
 *   AICore on supported phones and falls back to the cloud (WebViews have no on-device model);
 * - App Check uses native Play Integrity / debug tokens instead of reCAPTCHA;
 * - speech, voice input and vibration use the Android system services.
 */

interface AndroidBridge {
  /** Async calls: the result arrives later through window.__heimdallNative.resolve/reject. */
  generate(id: number, request: string): void;
  deviceStatus(id: number): void;
  prepareDevice(id: number): void;
  appCheckToken(id: number, forceRefresh: boolean): void;
  listen(id: number, lang: string): void;
  stopListening(): void;
  /** Sync calls. */
  speak(text: string, lang: string, rate: number, voice: string): void;
  stopSpeaking(): void;
  isSpeaking(): boolean;
  voices(): string;
  vibrate(pattern: string): void;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

const bridge = (globalThis as unknown as { HeimdallAndroid?: AndroidBridge }).HeimdallAndroid;
const pending = new Map<number, Pending>();
const listeners = new Map<string, Set<(payload: unknown) => void>>();
let nextId = 1;

if (bridge) {
  (globalThis as unknown as Record<string, unknown>).__heimdallNative = {
    resolve(id: number, json: string) {
      const p = pending.get(id);
      pending.delete(id);
      p?.resolve(JSON.parse(json));
    },
    reject(id: number, message: string) {
      const p = pending.get(id);
      pending.delete(id);
      p?.reject(new Error(message));
    },
    event(name: string, json: string) {
      const payload = JSON.parse(json);
      listeners.get(name)?.forEach((cb) => cb(payload));
    },
  };
}

export const native = bridge;
export const isAndroidApp = !!bridge;

/** Calls an async bridge method; the native side answers with the same id. */
export function call<T>(start: (id: number) => void): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    try {
      start(id);
    } catch (e) {
      pending.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export function onNativeEvent(name: string, cb: (payload: unknown) => void) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name)!.add(cb);
  return () => {
    listeners.get(name)?.delete(cb);
  };
}
