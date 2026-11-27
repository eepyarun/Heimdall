import { call, native, onNativeEvent } from './native';

// Android's WebView has no Web Speech API, so the Android app speaks and listens through native services.
const synth = typeof window !== 'undefined' && !native ? window.speechSynthesis : undefined;

type Voice = Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'voiceURI' | 'localService'>;

function allVoices(): Voice[] {
  if (native) {
    try {
      return JSON.parse(native.voices()) as Voice[];
    } catch {
      return [];
    }
  }
  return synth?.getVoices() ?? [];
}

let rate = Number(localStorage.getItem('heimdall.rate') ?? '1');

export function setRate(r: number) {
  rate = r;
  localStorage.setItem('heimdall.rate', String(r));
}

export function getRate() {
  return rate;
}

let chosenVoice = localStorage.getItem('heimdall.voice') ?? '';
let localOnly = false;

export function setVoice(uri: string) {
  chosenVoice = uri;
  localStorage.setItem('heimdall.voice', uri);
}

export function getVoice() {
  return chosenVoice;
}

/** In Private mode the answer text must not go to a cloud voice either (Chrome's "Google" voices and Edge "Online" voices are network-backed). */
export function setLocalVoicesOnly(v: boolean) {
  localOnly = v;
}

/** Higher is more natural: neural/online voices (Edge, Windows), Siri enhanced/premium (iOS, macOS), then Google's Chrome voices. */
function naturalness(v: Voice) {
  let s = 0;
  if (/natural|neural/i.test(v.name)) s += 6;
  if (/premium|enhanced|siri/i.test(v.name)) s += 5;
  if (/online/i.test(v.name)) s += 3;
  if (/google/i.test(v.name)) s += 3;
  if (/compact|espeak/i.test(v.name)) s -= 4;
  return s;
}

/** Voices for a language, most natural first. */
export function voicesFor(lang: string): Voice[] {
  const base = lang.slice(0, 2).toLowerCase();
  return allVoices()
    .filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(base) && (!localOnly || v.localService))
    .sort((a, b) => naturalness(b) - naturalness(a) + (b.lang === lang ? 1 : 0) - (a.lang === lang ? 1 : 0));
}

export function onVoicesChanged(cb: () => void) {
  if (native) return onNativeEvent('voiceschanged', cb);
  synth?.addEventListener('voiceschanged', cb);
  return () => synth?.removeEventListener('voiceschanged', cb);
}

function pickVoice(lang: string) {
  const all = voicesFor(lang);
  return all.find((v) => v.voiceURI === chosenVoice) ?? all[0];
}

/** Chunks of whole sentences up to ~180 characters: Chrome's network voices stop mid-utterance after ~15 seconds. */
function chunks(text: string) {
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]*\s*/g) ?? [text];
  const out: string[] = [];
  for (const s of sentences) {
    const last = out.length - 1;
    if (last >= 0 && out[last].length + s.length <= 180) out[last] += s;
    else out.push(s);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Speech synthesis uses the platform's voices; any new speech cuts off whatever was playing. */
export function speak(text: string, lang = 'en-US') {
  if (!text) return;
  const voice = pickVoice(lang);
  if (native) return native.speak(text, voice?.lang ?? lang, rate, voice?.voiceURI ?? '');
  if (!synth) return;
  synth.cancel();
  for (const part of chunks(text)) {
    const u = new SpeechSynthesisUtterance(part);
    u.lang = voice?.lang ?? lang;
    u.rate = rate;
    if (voice) u.voice = voice as SpeechSynthesisVoice;
    synth.speak(u);
  }
}

export function stopSpeaking() {
  if (native) return native.stopSpeaking();
  synth?.cancel();
}

export function isSpeaking() {
  if (native) return native.isSpeaking();
  return !!synth?.speaking || !!synth?.pending;
}

type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: (e: { results: { 0: { transcript: string } }[] }) => void;
  onerror: (e: { error: string }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};

export function canListen() {
  if (native) return true;
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
}

/** Resolves with one spoken phrase. Uses the platform speech recognizer (Chrome and Safari). */
export function listen(lang = 'en-US'): { result: Promise<string>; stop: () => void } {
  if (native) {
    const result = call<string>((id) => native!.listen(id, lang));
    return { result, stop: () => native!.stopListening() };
  }
  const Ctor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition })
    .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition: new () => Recognition }).webkitSpeechRecognition;
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  const result = new Promise<string>((resolve, reject) => {
    let heard = '';
    rec.onresult = (e) => {
      heard = e.results[0][0].transcript;
    };
    rec.onerror = (e) => reject(new Error(e.error === 'not-allowed' ? 'Microphone permission was denied.' : `Speech recognition: ${e.error}`));
    rec.onend = () => resolve(heard);
  });
  rec.start();
  return { result, stop: () => rec.stop() };
}

export function buzz(pattern: number | number[] = 30) {
  if (native) native.vibrate(JSON.stringify(pattern));
  else navigator.vibrate?.(pattern);
}
