import type { Privacy, SavedItem } from '../types';
import { LANGUAGES } from '../lib/vision';
import { config } from '../lib/config';

const PRIVACY: { id: Privacy; title: string; body: string }[] = [
  { id: 'private', title: 'Private', body: 'Photos never leave this device. Needs on-device AI.' },
  { id: 'smart', title: 'Smart (recommended)', body: 'On this device first. If it is unsure, or it is a medicine it can’t read clearly, it double-checks in the cloud.' },
  { id: 'quality', title: 'Best quality', body: 'Cloud first for the most detail. Falls back to this device when offline.' },
];

interface Props {
  privacy: Privacy;
  lang: string;
  rate: number;
  speakAnswers: boolean;
  simulateNoDevice: boolean;
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

        <h3>Demo</h3>
        <label className="toggle">
          <input type="checkbox" checked={p.simulateNoDevice} onChange={(e) => p.onSimulate(e.target.checked)} />
          Simulate a device without on-device AI (shows the cloud fallback)
        </label>
      </div>
    </div>
  );
}
