import { useCallback, useEffect, useRef, useState } from 'react';
import type { Part } from 'firebase/ai';
import type { User } from 'firebase/auth';
import { isConfigured, watchUser } from './lib/firebase';
import { loadConfig } from './lib/config';
import { checkDevice, setDeviceDisabled, isDeviceDisabled, type DeviceState } from './lib/device';
import { fileToPart, partToDataUrl, see, SPEECH_LANG, verifyInCloud, warmUp, type SeeOptions } from './lib/vision';
import { isBusyError, PrivateModeUnavailable } from './lib/policy';
import { buzz, canListen, getRate, listen, setRate, speak, stopSpeaking } from './lib/speech';
import { tone } from './lib/sound';
import { removeItem, saveItem, watchItems } from './lib/items';
import { renderSample, SAMPLES } from './lib/samples';
import type { Answer, Mode, Privacy, SavedItem } from './types';
import { Camera, type CameraHandle } from './components/Camera';
import { AnswerCard } from './components/AnswerCard';
import { Settings } from './components/Settings';

const MODES: { id: Mode; label: string; icon: string; hint: string }[] = [
  { id: 'describe', label: 'Describe', icon: '👁', hint: 'What is in front of me' },
  { id: 'read', label: 'Read', icon: '📄', hint: 'Read text aloud' },
  { id: 'identify', label: 'Identify', icon: '💊', hint: 'Medicine, money, products' },
  { id: 'translate', label: 'Translate', icon: '🌐', hint: 'Signs and menus' },
  { id: 'ask', label: 'Ask', icon: '❓', hint: 'Ask a question' },
];

const DEVICE_COPY: Record<DeviceState, string> = {
  checking: 'Checking…',
  available: 'On-device AI ready',
  downloadable: 'Tap to enable on-device AI',
  downloading: 'Downloading on-device AI',
  unavailable: 'Cloud AI',
  unsupported: 'Cloud AI',
  disabled: 'Cloud AI (simulated)',
};

function errorMessage(e: unknown): string {
  const s = String(e);
  if (e instanceof PrivateModeUnavailable) return e.message;
  if (/api key|app.?check|403|401/i.test(s)) return 'Heimdall could not reach its cloud AI. Check the Firebase setup.';
  if (isBusyError(e)) return 'The cloud AI is busy right now. Please try again in a moment.';
  if (!navigator.onLine || /failed to fetch|network/i.test(s)) return 'You seem to be offline and on-device AI is not available here.';
  return `Something went wrong: ${e instanceof Error ? e.message : s}`;
}

export default function App() {
  if (!isConfigured) return <SetupScreen />;
  return <Heimdall />;
}

function Heimdall() {
  const [user, setUser] = useState<User | null>(null);
  const [device, setDevice] = useState<DeviceState>('checking');
  const [progress, setProgress] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  const [mode, setMode] = useState<Mode>('describe');
  const [privacy, setPrivacy] = useState<Privacy>(() => (localStorage.getItem('heimdall.privacy') as Privacy) || 'smart');
  const [lang, setLang] = useState(() => localStorage.getItem('heimdall.lang') || 'en');
  const [rate, setRateState] = useState(getRate());
  const [speakAnswers, setSpeakAnswers] = useState(() => localStorage.getItem('heimdall.speak') !== '0');
  const [simulate, setSimulate] = useState(isDeviceDisabled());
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [image, setImage] = useState<Part | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [question, setQuestion] = useState('');
  const [listening, setListening] = useState(false);
  const [items, setItems] = useState<SavedItem[]>([]);

  const cam = useRef<CameraHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const samplesMenu = useRef<HTMLDetailsElement>(null);
  const warmed = useRef(false);
  const lastOpts = useRef<SeeOptions | null>(null);
  const speechLang = SPEECH_LANG[lang] ?? 'en-US';

  useEffect(() => watchUser(setUser), []);
  useEffect(() => {
    // Never block the camera on Remote Config; defaults apply until it arrives.
    const t = setTimeout(() => setReady(true), 3000);
    loadConfig().finally(() => {
      clearTimeout(t);
      setReady(true);
    });
  }, []);
  useEffect(() => {
    checkDevice(lang).then(setDevice);
  }, [simulate, lang]);
  useEffect(() => (user ? watchItems(user.uid, setItems) : undefined), [user]);
  useEffect(() => localStorage.setItem('heimdall.privacy', privacy), [privacy]);
  useEffect(() => localStorage.setItem('heimdall.lang', lang), [lang]);
  useEffect(() => localStorage.setItem('heimdall.speak', speakAnswers ? '1' : '0'), [speakAnswers]);

  const say = useCallback(
    (text: string) => {
      setStatus(text);
      if (speakAnswers) speak(text, speechLang);
    },
    [speakAnswers, speechLang],
  );

  const ensureWarm = () => {
    if (warmed.current || simulate) return;
    warmed.current = true;
    if (device === 'downloadable' || device === 'downloading') setDevice('downloading');
    warmUp((p) => setProgress(p)).finally(() => checkDevice(lang).then(setDevice));
  };

  const run = async (img: Part, m: Mode, q?: string) => {
    setBusy(true);
    setError('');
    setImage(img);
    tone('shutter');
    buzz(30);
    setStatus(m === 'ask' ? 'Thinking…' : 'Looking…');
    const opts: SeeOptions = { mode: m, image: img, privacy, lang, question: q, saved: items };
    lastOpts.current = opts;
    try {
      const a = await see(opts);
      setAnswers((xs) => [a, ...xs].slice(0, 10));
      tone('done');
      buzz([20, 40, 20]);
      const prefix = a.escalated ? 'Double-checked. ' : '';
      say(prefix + a.result.speech + (a.result.tip ? ` Tip: ${a.result.tip}` : ''));
    } catch (e) {
      tone('error');
      const msg = errorMessage(e);
      setError(msg);
      say(msg);
    } finally {
      setBusy(false);
    }
  };

  const look = async () => {
    if (busy) return;
    stopSpeaking();
    ensureWarm();
    if (mode === 'ask') {
      const img = image ?? (await cam.current?.capture());
      if (!img) return say('Take or choose a photo first.');
      if (!question.trim()) return startListening(img);
      const q = question.trim();
      setQuestion('');
      return run(img, 'ask', q);
    }
    const img = await cam.current?.capture();
    if (!img) return say('The camera is not ready. Choose a photo instead.');
    run(img, mode);
  };

  const startListening = async (img: Part) => {
    if (!canListen()) return say('Type your question in the box, then press Look.');
    setListening(true);
    speak('Ask your question.', speechLang);
    await new Promise((r) => setTimeout(r, 900));
    try {
      const q = (await listen(speechLang).result).trim();
      setListening(false);
      if (q) run(img, 'ask', q);
      else say('I did not hear a question.');
    } catch (e) {
      setListening(false);
      say(e instanceof Error ? e.message : 'Could not listen.');
    }
  };

  const analyzePart = (part: Part, m: Mode) => {
    ensureWarm();
    setMode(m);
    if (m === 'ask') {
      setImage(part);
      say('Photo ready. Ask your question.');
    } else run(part, m);
  };

  const onFile = async (file: File | undefined) => {
    if (file) analyzePart(await fileToPart(file), mode);
  };

  const loadSample = async (s: (typeof SAMPLES)[number]) => {
    analyzePart(await renderSample(s.draw), s.mode);
  };

  const verify = async (a: Answer) => {
    if (!lastOpts.current || busy) return;
    setBusy(true);
    say('Double-checking in the cloud.');
    try {
      const v = await verifyInCloud({ ...lastOpts.current, mode: a.mode, question: a.question }, a);
      setAnswers((xs) => [v, ...xs.filter((x) => x.id !== a.id)]);
      tone('done');
      say(v.result.speech);
    } catch (e) {
      tone('error');
      const msg = errorMessage(e);
      setError(msg);
      say(msg);
    } finally {
      setBusy(false);
    }
  };

  const save = async (a: Answer) => {
    if (!user || !a.result.name) return;
    await saveItem(user.uid, { id: crypto.randomUUID(), name: a.result.name, category: a.result.category ?? 'other', facts: a.result.facts ?? [], savedAt: Date.now() });
    say(`Saved ${a.result.name} to My things.`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [role=dialog]')) return;
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        look();
      } else if (/^[1-5]$/.test(e.key)) {
        const m = MODES[Number(e.key) - 1];
        setMode(m.id);
        say(m.label);
      } else if (e.key.toLowerCase() === 'r' && answers[0]) say(answers[0].result.speech);
      else if (e.key === 'Escape') stopSpeaking();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const current = answers[0];
  const frozen = image ? partToDataUrl(image) : null;
  const deviceTone = device === 'available' ? 'good' : device === 'downloading' || device === 'downloadable' ? 'warn' : 'cloud';

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">
          <img className="logo" src="/favicon.svg" alt="" /> Heimdall
        </h1>
        <button
          className={`status-chip ${deviceTone}`}
          onClick={() => device === 'downloadable' && ensureWarm()}
          aria-label={`AI status: ${DEVICE_COPY[device]}. Privacy: ${privacy}.`}
        >
          <span className="dot" />
          {DEVICE_COPY[device]}
          {device === 'downloading' && progress !== null && ` ${Math.round(progress * 100)}%`}
        </button>
        <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">⚙</button>
      </header>

      <main className="stage">
        <div className="viewer">
          <Camera ref={cam} frozen={frozen} />
          {busy && <div className="scanning" aria-hidden />}
          {frozen && !busy && (
            <button className="live-btn" onClick={() => { setImage(null); setError(''); setStatus(''); }}>
              ● Back to live camera
            </button>
          )}
        </div>

        <div className="controls">
          <div className="modes" role="radiogroup" aria-label="Mode">
            {MODES.map((m, i) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={mode === m.id}
                className={mode === m.id ? 'on' : ''}
                onClick={() => setMode(m.id)}
                title={`${m.hint} (key ${i + 1})`}
              >
                <span aria-hidden>{m.icon}</span>
                {m.label}
              </button>
            ))}
          </div>

          {mode === 'ask' && (
            <form className="ask-row" onSubmit={(e) => { e.preventDefault(); look(); }}>
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={image ? 'Ask about this photo…' : 'Ask about what the camera sees…'}
                aria-label="Your question"
              />
              {canListen() && (
                <button type="button" className="mic" onClick={async () => { const img = image ?? (await cam.current?.capture()); if (img) startListening(img); }} aria-label="Ask by voice" disabled={busy || listening}>
                  {listening ? '…' : '🎤'}
                </button>
              )}
            </form>
          )}

          <div className="shutter-row">
            <button className="secondary" onClick={() => fileInput.current?.click()} disabled={busy}>
              🖼 Choose photo
            </button>
            <button className={`shutter ${busy ? 'busy' : ''}`} onClick={look} disabled={busy || !ready} aria-label={`${MODES.find((m) => m.id === mode)!.label}. Take photo and ${mode === 'ask' ? 'ask' : 'look'}`}>
              {busy ? <span className="spinner" /> : mode === 'ask' ? 'Ask' : 'Look'}
            </button>
            <details className="samples" ref={samplesMenu}>
              <summary className="secondary">🧪 Samples</summary>
              <div className="samples-menu">
                {SAMPLES.map((s) => (
                  <button key={s.id} onClick={() => { samplesMenu.current?.removeAttribute('open'); loadSample(s); }} disabled={busy}>
                    {s.label}
                  </button>
                ))}
              </div>
            </details>
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        </div>

        <div className="live" aria-live="polite" aria-atomic="true">
          {error ? <p className="error">{error}</p> : busy ? <p className="muted">{status}</p> : null}
        </div>

        {current && (
          <AnswerCard
            answer={current}
            busy={busy}
            canVerify={!current.escalated && current.attempts[current.attempts.length - 1].engine === 'on_device' && privacy !== 'quality'}
            canSave={current.mode === 'identify' && !!current.result.name && !!user}
            onRepeat={() => say(current.result.speech)}
            onReadAll={current.result.text || current.result.translation ? () => say(current.result.translation || current.result.text || '') : undefined}
            onVerify={() => verify(current)}
            onSave={() => save(current)}
            onAsk={() => { setMode('ask'); say('Ask your question about this photo.'); }}
          />
        )}

        {answers.length > 1 && (
          <details className="history">
            <summary>Earlier answers ({answers.length - 1})</summary>
            <ul>
              {answers.slice(1).map((a) => (
                <li key={a.id}>
                  <strong>{MODES.find((m) => m.id === a.mode)!.label}:</strong> {a.result.speech}
                </li>
              ))}
            </ul>
          </details>
        )}
      </main>

      {settingsOpen && (
        <Settings
          privacy={privacy}
          lang={lang}
          rate={rate}
          speakAnswers={speakAnswers}
          simulateNoDevice={simulate}
          items={items}
          onPrivacy={setPrivacy}
          onLang={setLang}
          onRate={(r) => { setRate(r); setRateState(r); }}
          onSpeakAnswers={setSpeakAnswers}
          onSimulate={(v) => { setDeviceDisabled(v); setSimulate(v); }}
          onRemoveItem={(id) => user && removeItem(user.uid, id)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

function SetupScreen() {
  return (
    <div className="setup">
      <h1>Heimdall needs a Firebase project</h1>
      <ol>
        <li>Create a Firebase project and add a Web app.</li>
        <li>Enable <strong>AI Logic</strong> (Gemini Developer API), <strong>App Check</strong>, <strong>Anonymous Auth</strong>, <strong>Firestore</strong> and <strong>Remote Config</strong>.</li>
        <li>Copy <code>.env.example</code> to <code>.env.local</code>, fill in the values, and restart <code>npm run dev</code>.</li>
      </ol>
      <p>See README.md for the full walkthrough.</p>
    </div>
  );
}
