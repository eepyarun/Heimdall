import type { Answer } from '../types';
import { Icon } from './Icon';

const ENGINE_LABEL = { on_device: 'On this device', in_cloud: 'Cloud' } as const;
const CONF_LABEL = { high: 'Sure', medium: 'Fairly sure', low: 'Not sure' } as const;

interface Props {
  answer: Answer;
  canVerify: boolean;
  canSave: boolean;
  busy: boolean;
  onRepeat: () => void;
  onReadAll?: () => void;
  onVerify: () => void;
  onSave: () => void;
  onAsk: () => void;
}

export function AnswerCard({ answer, canVerify, canSave, busy, onRepeat, onReadAll, onVerify, onSave, onAsk }: Props) {
  const r = answer.result;
  const last = answer.attempts[answer.attempts.length - 1];
  return (
    <section className="answer" aria-labelledby={`ans-${answer.id}`}>
      <div className="answer-badges">
        {last && (
          <span className={`badge engine-${last.engine}`}>
            <Icon name={last.engine === 'on_device' ? 'chip' : 'cloud'} size={14} /> {ENGINE_LABEL[last.engine]}
          </span>
        )}
        <span className={`badge conf-${r.confidence}`}>
          <Icon name={r.confidence === 'high' ? 'check' : 'alert'} size={14} /> {CONF_LABEL[r.confidence]}
        </span>
        {answer.escalated && (
          <span className="badge escalated">
            <Icon name="shield" size={14} /> Double-checked
          </span>
        )}
        {answer.live && (
          <span className="badge live-tag">
            <Icon name="live" size={14} /> Live
          </span>
        )}
      </div>
      {answer.question && <p className="question">“{answer.question}”</p>}
      <p id={`ans-${answer.id}`} className="speech">{r.speech}</p>
      {r.tip && <p className="tip">{r.tip}</p>}

      {!!r.hazards?.length && (
        <div className="block hazards">
          <h3>Hazards</h3>
          <ul>{r.hazards.map((h, i) => <li key={i}>{h}</li>)}</ul>
        </div>
      )}
      {r.name && answer.mode === 'identify' && <p className="item-name">{r.name}</p>}
      {!!r.facts?.length && (
        <dl className="facts">
          {r.facts.map((f, i) => (
            <div key={i}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {!!r.warnings?.length && (
        <div className="block warnings" role="alert">
          <h3>Warnings</h3>
          <ul>{r.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {r.lines?.length ? (
        <div className="block">
          <h3>Translation{r.sourceLanguage ? ` from ${r.sourceLanguage}` : ''}</h3>
          <table className="lines">
            <thead>
              <tr>
                <th scope="col">Original{r.sourceLanguage ? ` (${r.sourceLanguage})` : ''}</th>
                <th scope="col">Translation</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.original}</td>
                  <td>{l.translation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        r.translation && (
          <div className="block">
            <h3>Translation{r.sourceLanguage ? ` from ${r.sourceLanguage}` : ''}</h3>
            <p className="pre">{r.translation}</p>
          </div>
        )
      )}
      {r.text && !r.lines?.length && (
        <details className="block">
          <summary>{answer.mode === 'translate' ? 'Original text' : 'Full text'}</summary>
          <p className="pre">{r.text}</p>
        </details>
      )}

      <div className="answer-actions">
        <button onClick={onRepeat}>
          <Icon name="speaker" size={20} /> Repeat
        </button>
        {onReadAll && (
          <button onClick={onReadAll}>
            <Icon name="book" size={20} /> Read all
          </button>
        )}
        <button onClick={onAsk} disabled={busy}>
          <Icon name="mic" size={20} /> Follow-up
        </button>
        {canSave && (
          <button onClick={onSave}>
            <Icon name="star" size={20} /> Save to My things
          </button>
        )}
        {canVerify && (
          <button onClick={onVerify} disabled={busy} className="verify">
            <Icon name="shield" size={20} /> Double-check in cloud
          </button>
        )}
      </div>

      {!!answer.attempts.length && (
        <details className="trail">
          <summary>How this answer was made</summary>
          <ol>
            {answer.attempts.map((a, i) => (
              <li key={i}>
                <span className={`badge engine-${a.engine}`}>{a.model}</span>
                {a.confidence && <span className={`badge conf-${a.confidence}`}>{CONF_LABEL[a.confidence]}</span>}
                <span className="ms">{(a.ms / 1000).toFixed(1)}s</span>
                <p>{a.reason}</p>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
