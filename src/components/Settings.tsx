import type { ColorStyle, Privacy, SavedItem } from '../types';
import { useEffect, useState } from 'react';
import { LANGUAGES, SPEECH_LANG } from '../lib/vision';
import { getVoice, onVoicesChanged, setVoice, speak, voicesFor } from '../lib/speech';
import { config } from '../lib/config';

const PRIVACY: { id: Privacy; title: string; body: string }[] = [
  { id: 'private', title: 'Private', body: 'Photos never leave this device. Needs on-device AI.' },
  { id: 'smart', title: 'Smart (recommended)', body: 'On this device first. If it is unsure, or it is a medicine it can’t read clearly, it double-checks in the cloud.' },
  { id: 'quality', title: 'Best quality', body: 'Cloud first for the most detail. Falls back to this device when offline.' },
];

const COLOR_STYLES: { id: ColorStyle; title: string; body: string }[] = [
  { id: 'calm', title: 'Calm (recommended)', body: 'Soft colours for each mode. Easier on the eyes and less distracting.' },
  { id: 'vivid', title: 'Vivid', body: 'Full-strength colours for each mode. Easier to tell apart with low vision.' },
];

const SHORTCUTS: [string, string][] = [
  ['Space', 'Take a photo and look'],
  ['M', 'Ask by voice'],
  ['L', 'Start or stop Live'],
  ['1–5', 'Choose a mode'],
  ['R', 'Repeat the last answer'],
  ['Esc', 'Stop speaking'],
];

interface Props {
  privacy: Privacy;
  lang: string;
  rate: number;
  speakAnswers: boolean;
  simulateNoDevice: boolean;
  colors: ColorStyle;
  onColors: (c: ColorStyle) => void;
  items: SavedItem[];
  onPrivacy: (p: Privacy) => void;
  onLang: (l: string) => void;
  onRate: (r: number) => void;
  onSpeakAnswers: (v: boolean) => void;
  onSimulate: (v: boolean) => void;
  onRemoveItem: (id: string) => void;
  onClose: () => void;
}

export function Settings(p: Props) {
  const onDevice = config().onDeviceLanguages;
  const [voice, setVoiceState] = useState(getVoice());
  const [, refresh] = useState(0);
  useEffect(() => onVoicesChanged(() => refresh((n) => n + 1)), []);
  const voices = voicesFor(SPEECH_LANG[p.lang] ?? 'en-US');
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal aria-labelledby="settings-title" onClick={p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 id="settings-title">Settings</h2>
          <button onClick={p.onClose} aria-label="Close settings">Done</button>
        </div>

        <fieldset>
          <legend>Privacy</legend>
          {PRIVACY.map((o) => (
            <label key={o.id} className={`radio-card ${p.privacy === o.id ? 'on' : ''}`}>
              <input type="radio" name="privacy" checked={p.privacy === o.id} onChange={() => p.onPrivacy(o.id)} />
              <span>
                <strong>{o.title}</strong>
                <small>{o.body}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>Mode colours</legend>
          {COLOR_STYLES.map((o) => (
            <label key={o.id} className={`radio-card ${p.colors === o.id ? 'on' : ''}`}>
              <input type="radio" name="colors" checked={p.colors === o.id} onChange={() => p.onColors(o.id)} />
              <span>
                <strong>{o.title}</strong>
                <small>{o.body}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <h3>Speech</h3>
        <label className="field">
          <span>Heimdall speaks</span>
          <select value={p.lang} onChange={(e) => p.onLang(e.target.value)}>
            {Object.entries(LANGUAGES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
                {onDevice.includes(code) ? '' : ' (cloud only)'}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Voice</span>
          <select value={voice} onChange={(e) => { setVoice(e.target.value); setVoiceState(e.target.value); speak('Hello, I am Heimdall.', SPEECH_LANG[p.lang]); }}>
            <option value="">Automatic (most natural on this device)</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name}
                {v.localService ? '' : ' (online)'}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Speaking speed: {p.rate.toFixed(1)}×</span>
          <input type="range" min={0.6} max={2} step={0.1} value={p.rate} onChange={(e) => p.onRate(Number(e.target.value))} />
        </label>

        <label className="toggle">
          <input type="checkbox" checked={p.speakAnswers} onChange={(e) => p.onSpeakAnswers(e.target.checked)} />
          Speak answers aloud (turn off if you use a screen reader)
        </label>

        <h3>My things</h3>
        {!p.items.length && <p className="muted">Save medicines and items you use often. Heimdall will recognise them. Only text is saved, never photos.</p>}
        <ul className="items">
          {p.items.map((i) => (
            <li key={i.id}>
              <span>
                <strong>{i.name}</strong>
                <small>{i.facts.map((f) => `${f.label}: ${f.value}`).join(' · ')}</small>
              </span>
              <button onClick={() => p.onRemoveItem(i.id)} aria-label={`Remove ${i.name}`}>Remove</button>
            </li>
          ))}
        </ul>

        <h3>Keyboard shortcuts</h3>
        <dl className="shortcuts">
          {SHORTCUTS.map(([key, action]) => (
            <div key={key}>
              <dt><kbd>{key}</kbd></dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>

        <h3>For demo</h3>
        <label className="toggle">
          <input type="checkbox" checked={p.simulateNoDevice} onChange={(e) => p.onSimulate(e.target.checked)} />
          Simulate a device without on-device AI (shows the cloud fallback)
        </label>

        <h3>About</h3>
        <div className="about">
          <p>
            <strong>Heimdall 1.0</strong>
            <br />
            Eyes for everyone. Built with Firebase AI Logic: Gemini Nano on your device, and Gemini in the cloud only when it helps.
          </p>
          <p className="muted">
            Photos are never stored. “My things” saves only text, in a private space for this device. Every answer shows how it was made.
          </p>
        </div>
      </div>
    </div>
  );
}
