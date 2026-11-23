const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

let rate = Number(localStorage.getItem('heimdall.rate') ?? '1');

export function setRate(r: number) {
  rate = r;
  localStorage.setItem('heimdall.rate', String(r));
}

export function getRate() {
  return rate;
}

/** Speech synthesis runs locally in the browser/OS, so spoken answers never add a network hop. */
export function speak(text: string, lang = 'en-US') {
  if (!synth || !text) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  const voice = synth.getVoices().find((v) => v.lang === lang) ?? synth.getVoices().find((v) => v.lang.startsWith(lang.slice(0, 2)));
  if (voice) u.voice = voice;
  synth.speak(u);
}

export function stopSpeaking() {
  synth?.cancel();
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
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
}

/** Resolves with one spoken phrase. Uses the platform speech recognizer (Chrome and Safari). */
export function listen(lang = 'en-US'): { result: Promise<string>; stop: () => void } {
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
  navigator.vibrate?.(pattern);
}
