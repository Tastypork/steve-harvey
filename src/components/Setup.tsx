import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, RefreshCw, Upload, Mic, MicOff, Play, Trash2, FolderOpen } from 'lucide-react';
import { personaImage } from '../assets';
import { deckWithFastMoneyFile, deckWithFastMoneySet, deckWithRoundsFile, loadDefaultDeck, pickFile } from '../game/deck';
import { MAX_TEAMS, MIN_TEAMS, multiplierFor, rankTeams } from '../game/engine';
import { PERSONAS, persona, randomUnusedPersonas } from '../game/personas';
import { store, useSaved } from '../game/store';
import type { Deck } from '../game/types';
import { useVoice } from '../voice/realtime';
import { Title } from './Title';

interface Slot {
  name: string;
  personaId: string;
  custom: boolean;
}

function newSlots(count: number): Slot[] {
  return randomUnusedPersonas(count).map((p) => ({ name: p.name, personaId: p.id, custom: false }));
}

export function Setup({ onEnter }: { onEnter: () => void }) {
  const saved = useSaved();
  const v = useVoice();
  const [slots, setSlots] = useState<Slot[]>(() => newSlots(2));
  const [picker, setPicker] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [firstId, setFirstId] = useState<string>('');
  const deck = saved.setupDeck;

  const reloadDefault = async () => {
    setLoading(true);
    const r = await loadDefaultDeck();
    store.setSetupDeck(r.deck);
    setWarnings(r.warnings);
    setFirstId('');
    setLoading(false);
  };

  useEffect(() => {
    if (!saved.setupDeck) void reloadDefault();
  }, []);

  const loadFile = async (kind: 'rounds' | 'fm') => {
    const file = await pickFile('.csv,text/csv');
    if (!file) return;
    const base: Deck = deck ?? { questions: [], fastMoney: [], roundsSource: '', fastMoneySource: '' };
    try {
      const r = kind === 'rounds' ? await deckWithRoundsFile(base, file) : await deckWithFastMoneyFile(base, file);
      store.setSetupDeck(r.deck);
      setWarnings(r.warnings);
      if (kind === 'rounds') setFirstId('');
    } catch (err) {
      setWarnings([`Could not read ${file.name}: ${err instanceof Error ? err.message : err}`]);
    }
  };

  const taken = slots.map((s) => s.personaId);
  const setSlot = (i: number, patch: Partial<Slot>) =>
    setSlots((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const addSlot = () => {
    if (slots.length >= MAX_TEAMS) return;
    const [p] = randomUnusedPersonas(1, taken);
    setSlots([...slots, { name: p.name, personaId: p.id, custom: false }]);
  };

  const removeSlot = () => {
    if (slots.length <= MIN_TEAMS) return;
    setSlots(slots.slice(0, -1));
    setPicker(null);
  };

  const choosePersona = (i: number, id: string) => {
    const s = slots[i];
    setSlot(i, { personaId: id, name: s.custom ? s.name : persona(id).name });
    setPicker(null);
  };

  const names = slots.map((s) => s.name.trim().toLowerCase());
  const dupName = names.some((n, i) => n && names.indexOf(n) !== i);
  const canStart = !!deck && deck.questions.length > 0 && !dupName;

  const start = () => {
    if (!deck || !canStart) return;
    if (saved.session && !window.confirm('Start a new game? The saved game will be replaced.')) return;
    store.startGame(
      slots.map((s) => ({ name: s.name, personaId: s.personaId })),
      deck,
      firstId || null,
    );
    onEnter();
  };

  const resume = saved.session;
  const resumeSummary = useMemo(() => {
    if (!resume) return '';
    const g = resume.game;
    const where =
      g.phase === 'fastMoney' ? 'Fast Money' : g.phase === 'winner' ? 'Final results' : `Round ${g.round?.number ?? 1}`;
    return `${where} · ${rankTeams(g.teams)
      .map((t) => `${t.name} ${t.total}`)
      .join(' · ')}`;
  }, [resume]);

  return (
    <div className="stage setup">
      <Title />
      <main className="setup-body">
        {resume ? (
          <section className="setup-resume" aria-label="Saved game">
            <div>
              <h2>Pick up where you left off</h2>
              <p>{resumeSummary}</p>
            </div>
            <div className="row-gap">
              <button className="show-btn" onClick={onEnter}>
                <Play size={20} /> Resume game
              </button>
              <button
                className="show-btn is-quiet"
                onClick={() => {
                  if (window.confirm('Discard the saved game? This cannot be undone.')) store.clearSession();
                }}
              >
                <Trash2 size={18} /> Discard
              </button>
            </div>
          </section>
        ) : null}

        <section className="setup-panel families" aria-label="Families">
          <div className="panel-head">
            <h2>Families</h2>
            <div className="stepper" aria-label="Number of families">
              <button className="icon-btn" onClick={removeSlot} disabled={slots.length <= MIN_TEAMS} aria-label="Fewer families">
                <Minus size={18} />
              </button>
              <span>{slots.length}</span>
              <button className="icon-btn" onClick={addSlot} disabled={slots.length >= MAX_TEAMS} aria-label="More families">
                <Plus size={18} />
              </button>
            </div>
          </div>

          <ol className="slots">
            {slots.map((s, i) => (
              <li key={i} className="slot">
                <button
                  className="slot-portrait"
                  onClick={() => setPicker(picker === i ? null : i)}
                  aria-label={`Change portrait for family ${i + 1}`}
                  aria-expanded={picker === i}
                >
                  <img src={personaImage(s.personaId)} alt="" />
                </button>
                <div className="slot-fields">
                  <label className="field-label" htmlFor={`team-${i}`}>
                    Family {i + 1}
                  </label>
                  <input
                    id={`team-${i}`}
                    className="text-input"
                    value={s.name}
                    maxLength={32}
                    onChange={(e) => setSlot(i, { name: e.target.value, custom: e.target.value !== persona(s.personaId).name })}
                    onBlur={() => {
                      if (!s.name.trim()) setSlot(i, { name: persona(s.personaId).name, custom: false });
                    }}
                  />
                </div>
                {picker === i ? (
                  <div className="persona-grid" role="listbox" aria-label="Portraits">
                    {PERSONAS.map((p) => {
                      const usedBy = taken.indexOf(p.id);
                      return (
                        <button
                          key={p.id}
                          role="option"
                          aria-selected={p.id === s.personaId}
                          className={`persona ${p.id === s.personaId ? 'is-selected' : ''}`}
                          disabled={usedBy !== -1 && usedBy !== i}
                          onClick={() => choosePersona(i, p.id)}
                        >
                          <img src={personaImage(p.id)} alt="" />
                          <span>{p.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          {dupName ? <p className="warn-line">Two families share a name. Give each one its own.</p> : null}
        </section>

        <section className="setup-panel deck" aria-label="Questions">
          <div className="panel-head">
            <h2>Survey questions</h2>
            <button className="icon-btn" onClick={() => void reloadDefault()} title="Reload public/data CSVs" aria-label="Reload default CSVs">
              <RefreshCw size={18} className={loading ? 'spin' : ''} />
            </button>
          </div>

          <div className="deck-row">
            <div>
              <strong>{deck?.questions.length ?? 0}</strong> main questions
              <small>{deck?.roundsSource || 'not loaded'}</small>
            </div>
            <button className="chip-btn" onClick={() => void loadFile('rounds')}>
              <Upload size={16} /> Load CSV
            </button>
          </div>
          <div className="deck-row">
            <div>
              <strong>{Math.min(5, deck?.fastMoney.length ?? 0)}</strong> Fast Money questions
              <small>{deck?.fastMoneySource || 'not loaded'}</small>
            </div>
            <button className="chip-btn" onClick={() => void loadFile('fm')}>
              <Upload size={16} /> Load CSV
            </button>
          </div>
          {deck && (deck.fastMoneyFiles?.length ?? 0) > 1 ? (
            <label className="first-q">
              <span className="field-label">Fast Money set</span>
              <select
                className="text-input"
                value={deck.fastMoneyFiles!.find((f) => deck.fastMoneySource.endsWith(f.name))?.name ?? ''}
                onChange={(e) => store.setSetupDeck(deckWithFastMoneySet(deck, e.target.value))}
              >
                {deck.fastMoneyFiles!.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {deck && deck.questions.length > 0 ? (
            <label className="first-q">
              <span className="field-label">First question</span>
              <select className="text-input" value={firstId} onChange={(e) => setFirstId(e.target.value)}>
                <option value="">Round order from the CSV</option>
                {deck.questions.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.round}. {q.prompt}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <p className="deck-note">
            Rounds play at x{multiplierFor(1)}, x{multiplierFor(2)}, x{multiplierFor(3)}, then x{multiplierFor(4)}.
          </p>

          {warnings.length ? (
            <ul className="warn-list">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}

          <div className="voice-line">
            {v.available ? <Mic size={16} /> : <MicOff size={16} />}
            {v.available === null
              ? 'Checking for the Harvey voice key...'
              : v.available
                ? 'Harvey voice is ready. Turn the mic on from the host bar.'
                : 'No XAI_API_KEY in .env, so Harvey runs manual only.'}
          </div>

          <div className="row-gap">
            <button
              className="chip-btn"
              onClick={async () => {
                const file = await pickFile('.json,application/json');
                if (!file) return;
                const err = store.importJson(await file.text());
                setWarnings(err ? [err] : ['Save imported. Resume it above.']);
              }}
            >
              <FolderOpen size={16} /> Import save
            </button>
          </div>
        </section>

        <div className="setup-start">
          <button className="show-btn is-big" onClick={start} disabled={!canStart}>
            Start the game
          </button>
        </div>
      </main>
    </div>
  );
}
