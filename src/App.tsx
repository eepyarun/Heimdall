import { useCallback, useEffect, useRef, useState } from 'react';
import type { Part } from 'firebase/ai';
import type { User } from 'firebase/auth';
import { isConfigured, watchUser } from './lib/firebase';
import { loadConfig } from './lib/config';
import { checkDevice, setDeviceDisabled, isDeviceDisabled, type DeviceState } from './lib/device';
import { fileToPart, partToDataUrl, see, SPEECH_LANG, verifyInCloud, warmUp, type SeeOptions } from './lib/vision';
import { frameDifference, isBusyError, LIVE_CHANGE_THRESHOLD, LIVE_CLOUD_FRAME_LIMIT, liveInterval, PrivateModeUnavailable } from './lib/policy';
import { buzz, canListen, getRate, isSpeaking, listen, setRate, speak, stopSpeaking } from './lib/speech';
import { tone } from './lib/sound';
import { removeItem, saveItem, watchItems } from './lib/items';
import { renderSample, SAMPLES } from './lib/samples';
import type { Answer, Mode, Privacy, SavedItem } from './types';
import { Camera, type CameraHandle } from './components/Camera';
import { AnswerCard } from './components/AnswerCard';
import { Settings } from './components/Settings';
import { Icon } from './components/Icon';

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'describe', label: 'Describe', hint: 'What is in front of me' },
  { id: 'read', label: 'Read', hint: 'Read text aloud' },
  { id: 'identify', label: 'Identify', hint: 'Medicine, money, products' },
  { id: 'translate', label: 'Translate', hint: 'Signs and menus' },
  { id: 'ask', label: 'Ask', hint: 'Type a question' },
];
const modeLabel = (m: Mode) => MODES.find((x) => x.id === m)!.label;

const DEVICE_COPY: Record<DeviceState, string> = {
  checking: 'Checking…',
  available: 'On-device AI',
  downloadable: 'Enable on-device',
  downloading: 'Downloading',
  unavailable: 'Cloud AI',
  unsupported: 'Cloud AI',
  disabled: 'Cloud AI (demo)',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const [live, setLive] = useState(false);
  const [caption, setCaption] = useState('');
  const [items, setItems] = useState<SavedItem[]>([]);

  const cam = useRef<CameraHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const samplesMenu = useRef<HTMLDetailsElement>(null);
  const warmed = useRef(false);
  const lastOpts = useRef<SeeOptions | null>(null);
  const stopListen = useRef<(() => void) | null>(null);
  const busyRef = useRef(false);
  const speechLang = SPEECH_LANG[lang] ?? 'en-US';

  // Live narration runs in a long-lived loop, so it reads current settings from a ref instead of stale closures.
  const latest = useRef({ mode, privacy, lang, items, device, simulate });
  latest.current = { mode, privacy, lang, items, device, simulate };

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

  const setBusyBoth = (v: boolean) => {
    busyRef.current = v;
    setBusy(v);
  };

  const run = async (img: Part, m: Mode, q?: string, context?: string) => {
    setBusyBoth(true);
    setError('');
    setImage(img);
    tone('shutter');
    buzz(30);
    setStatus(m === 'ask' ? 'Thinking…' : 'Looking…');
    const opts: SeeOptions = { mode: m, image: img, privacy, lang, question: q, saved: items, context };
    lastOpts.current = opts;
    try {
      const a = await see(opts);
      setAnswers((xs) => [a, ...xs.filter((x) => !x.live)].slice(0, 10));
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
      setBusyBoth(false);
    }
  };

  // ---------- live narration ----------

  const stopLive = (announce = true) => {
    if (!live) return;
    setLive(false);
    setCaption('');
    if (announce) {
      tone('liveOff');
      say('Live off.');
    }
  };

  const startLive = () => {
    stopSpeaking();
    ensureWarm();
    setImage(null);
    setError('');
    const m = mode === 'ask' ? 'describe' : mode;
    setMode(m);
    setLive(true);
    tone('liveOn');
    buzz([30, 30, 30]);
    say(`Live ${modeLabel(m)}. I'll speak when something changes.`);
  };

  useEffect(() => {
    if (!live) return;
    let stopped = false;
    let wakeLock: { release: () => Promise<void> } | undefined;
    (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<typeof wakeLock> } }).wakeLock
      ?.request('screen')
      .then((w) => (wakeLock = w))
      .catch(() => undefined);

    const loop = async () => {
      let lastSig: Uint8Array | null = null;
      let previous = '';
      let lastTip = '';
      let cloudFrames = 0;
      while (!stopped) {
        const s = latest.current;
        await sleep(liveInterval(s.device === 'available' && !s.simulate));
        if (stopped) break;
        if (document.hidden || busyRef.current || isSpeaking()) continue;
        const sig = cam.current?.signature();
        if (!sig) continue;
        if (lastSig && frameDifference(sig, lastSig) < LIVE_CHANGE_THRESHOLD) continue;
        const img = await cam.current?.capture(768);
        if (!img) continue;
        lastSig = sig;
        try {
          const a = await see({ mode: s.mode, image: img, privacy: s.privacy, lang: s.lang, saved: s.items, live: true, previous });
          if (stopped) break;
          if (a.attempts.some((x) => x.engine === 'in_cloud')) cloudFrames++;
          if (a.result.speech) {
            previous = a.result.speech;
            setAnswers((xs) => [a, ...xs.filter((x) => !x.live)].slice(0, 10));
            setCaption(a.result.speech);
            say(a.result.speech);
          } else if (a.result.tip && a.result.tip !== lastTip) {
            lastTip = a.result.tip;
            setCaption(a.result.tip);
            say(a.result.tip);
          }
          if (cloudFrames >= LIVE_CLOUD_FRAME_LIMIT) {
            setLive(false);
            setCaption('');
            say('Live paused to save cloud data. Tap Live to continue.');
            break;
          }
        } catch (e) {
          if (stopped) break;
          setLive(false);
          setCaption('');
          tone('error');
          const msg = errorMessage(e);
          setError(msg);
          say(msg);
          break;
        }
      }
    };
    loop();
    return () => {
      stopped = true;
      wakeLock?.release().catch(() => undefined);
    };
  }, [live, say]);

  // ---------- actions ----------

  const look = async () => {
    if (busy) return;
    stopLive(false);
    stopSpeaking();
    ensureWarm();
    if (mode === 'ask') {
      const img = image ?? (await cam.current?.capture());
      if (!img) return say('Take or choose a photo first.');
      if (!question.trim()) return askByVoice(img);
      const q = question.trim();
      setQuestion('');
      return run(img, 'ask', q, contextFor(img));
    }
    const img = await cam.current?.capture();
    if (!img) return say('The camera is not ready. Choose a photo instead.');
    run(img, mode);
  };

  /** Follow-ups about the same photo carry the last answer, so "what about the expiry date?" makes sense. */
  const contextFor = (img: Part) => (lastOpts.current?.image === img && answers[0] ? answers[0].result.speech : undefined);

  const askByVoice = async (given?: Part) => {
    if (listening) return stopListen.current?.();
    if (busy) return;
    if (!canListen()) {
      setMode('ask');
      return say('Voice questions are not supported in this browser. Type your question instead.');
    }
    stopLive(false);
    stopSpeaking();
    ensureWarm();
    const img = given ?? image ?? (await cam.current?.capture());
    if (!img) return say('The camera is not ready. Choose a photo first.');
    setImage(img);
    setError('');
    setListening(true);
    setCaption('Listening…');
    tone('listen');
    buzz(20);
    const l = listen(speechLang);
    stopListen.current = l.stop;
    try {
      const q = (await l.result).trim();
      if (q) {
        setCaption(`“${q}”`);
        await run(img, 'ask', q, contextFor(img));
      } else {
        say('I did not hear a question. Tap the microphone and try again.');
      }
    } catch (e) {
      say(e instanceof Error ? e.message : 'Could not listen.');
    } finally {
      setListening(false);
      stopListen.current = null;
      setCaption('');
    }
  };

  const analyzePart = (part: Part, m: Mode) => {
    stopLive(false);
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
    setBusyBoth(true);
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
      setBusyBoth(false);
    }
  };

  const save = async (a: Answer) => {
    if (!user || !a.result.name) return;
    await saveItem(user.uid, { id: crypto.randomUUID(), name: a.result.name, category: a.result.category ?? 'other', facts: a.result.facts ?? [], savedAt: Date.now() });
    say(`Saved ${a.result.name} to My things.`);
  };

  const backToCamera = () => {
    setImage(null);
    setError('');
    setStatus('');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [role=dialog]')) return;
      const k = e.key.toLowerCase();
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        look();
      } else if (/^[1-5]$/.test(e.key)) {
        const m = MODES[Number(e.key) - 1];
        setMode(m.id);
        say(m.label);
      } else if (k === 'm') askByVoice();
      else if (k === 'l') (live ? stopLive() : startLive());
      else if (k === 'r' && answers[0]) say(answers[0].result.speech);
      else if (e.key === 'Escape') {
        stopSpeaking();
        stopLive();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const current = answers[0];
  const frozen = image ? partToDataUrl(image) : null;
  const deviceTone = device === 'available' ? 'good' : device === 'downloading' || device === 'downloadable' ? 'warn' : 'cloud';

  return (
    <div className="app" data-mode={mode}>
      <main className="stage">
        <section className={`viewer ${live ? 'is-live' : ''} ${busy ? 'is-busy' : ''}`} aria-label="Camera">
          <Camera ref={cam} frozen={frozen} />
          {busy && <div className="scanning" aria-hidden />}

          <header className="viewer-top">
            <h1 className="brand">
              <img className="logo" src="/favicon.svg" alt="" /> <span className="brand-name">Heimdall</span>
            </h1>
            <button
              className={`status-chip ${deviceTone}`}
              onClick={() => device === 'downloadable' && ensureWarm()}
              aria-label={`AI: ${DEVICE_COPY[device]}. Privacy: ${privacy}.${device === 'downloadable' ? ' Tap to download on-device AI.' : ''}`}
            >
              {DEVICE_COPY[device]}
              {device === 'downloading' && progress !== null && ` ${Math.round(progress * 100)}%`}
            </button>
            <button className="glass-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
              <Icon name="settings" />
            </button>
          </header>

          {live && (
            <div className="live-badge" aria-hidden>
              <span className="pulse" /> LIVE · {modeLabel(mode)}
            </div>
          )}

          {caption && (
            <p className="caption" aria-hidden>
              {caption}
            </p>
          )}

          <div className="viewer-bottom">
            <button className="glass-btn labeled" onClick={() => fileInput.current?.click()} disabled={busy}>
              <Icon name="photo" size={20} /> Photo
            </button>
            {frozen && !busy && !listening && (
              <button className="glass-btn labeled" onClick={backToCamera}>
                <Icon name="back" size={20} /> Camera
              </button>
            )}
            <details className="samples" ref={samplesMenu}>
              <summary className="glass-btn labeled">
                <Icon name="sample" size={20} /> Samples
              </summary>
              <div className="samples-menu">
                {SAMPLES.map((s) => (
                  <button key={s.id} onClick={() => { samplesMenu.current?.removeAttribute('open'); loadSample(s); }} disabled={busy}>
                    {s.label}
                  </button>
                ))}
              </div>
            </details>
          </div>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </section>

        <div className="modes" role="radiogroup" aria-label="Mode">
          {MODES.map((m, i) => (
            <button
              key={m.id}
              role="radio"
              data-mode={m.id}
              aria-checked={mode === m.id}
              className={mode === m.id ? 'on' : ''}
              onClick={() => {
                setMode(m.id);
                if (live && m.id === 'ask') stopLive();
              }}
              title={`${m.hint} (key ${i + 1})`}
            >
              <Icon name={m.id} size={26} />
              <span>{m.label}</span>
            </button>
          ))}
        </div>

        {mode === 'ask' && (
          <form className="ask-row" onSubmit={(e) => { e.preventDefault(); look(); }}>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={image ? 'Ask about this photo' : 'Ask about what the camera sees'}
              aria-label="Your question"
            />
            <button type="submit" disabled={busy || !question.trim()}>Send</button>
          </form>
        )}

        <div className="dock">
          <button
            className={`dock-btn ${live ? 'on' : ''}`}
            onClick={() => (live ? stopLive() : startLive())}
            aria-pressed={live}
            disabled={busy || !ready || listening}
          >
            <span className="dock-icon">{live ? <Icon name="stop" size={28} /> : <Icon name="live" size={28} />}</span>
            <span className="dock-label">{live ? 'Stop live' : 'Live'}</span>
          </button>

          <button
            className={`shutter ${busy ? 'busy' : ''}`}
            onClick={look}
            disabled={busy || !ready || listening}
            aria-label={`${modeLabel(mode)}. Take photo and ${mode === 'ask' ? 'ask' : 'look'}`}
          >
            {busy ? <span className="spinner" /> : mode === 'ask' ? 'Ask' : 'Look'}
          </button>

          <button
            className={`dock-btn ${listening ? 'on listening' : ''}`}
            onClick={() => askByVoice()}
            disabled={(busy && !listening) || !ready}
            aria-label={listening ? 'Stop listening' : 'Ask by voice about what the camera sees'}
          >
            <span className="dock-icon"><Icon name="mic" size={28} /></span>
            <span className="dock-label">{listening ? 'Listening' : 'Voice'}</span>
          </button>
        </div>

        <div className="live" aria-live="polite" aria-atomic="true">
          {error ? <p className="error">{error}</p> : busy || live ? <p className="muted">{status}</p> : null}
        </div>

        {current && (
          <AnswerCard
            answer={current}
            busy={busy}
            canVerify={!current.live && !current.escalated && current.attempts[current.attempts.length - 1]?.engine === 'on_device' && privacy !== 'quality'}
            canSave={current.mode === 'identify' && !!current.result.name && !!user}
            onRepeat={() => say(current.result.speech)}
            onReadAll={current.result.text || current.result.translation ? () => say(current.result.translation || current.result.text || '') : undefined}
            onVerify={() => verify(current)}
            onSave={() => save(current)}
            onAsk={() => askByVoice()}
          />
        )}

        {answers.length > 1 && (
          <details className="history">
            <summary>Earlier answers ({answers.length - 1})</summary>
            <ul>
              {answers.slice(1).map((a) => (
                <li key={a.id}>
                  <strong>{modeLabel(a.mode)}:</strong> {a.result.speech}
                </li>
              ))}
            </ul>
          </details>
        )}

        <p className="shortcuts muted">
          Keys: Space look · M ask by voice · L live · 1–5 modes · R repeat · Esc stop
        </p>
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
