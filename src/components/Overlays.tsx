import { X } from 'lucide-react';
import { useFx, fx } from '../ui/fx';
import { SHORTCUTS } from '../ui/hotkeys';

export function Toasts() {
  const { toasts } = useFx();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast is-${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function HelpOverlay() {
  const { helpOpen } = useFx();
  if (!helpOpen) return null;
  return (
    <div className="help-scrim" onClick={() => fx.setHelp(false)}>
      <div className="help" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <h2>Host shortcuts</h2>
          <button className="icon-btn" onClick={() => fx.setHelp(false)} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <dl>
          {SHORTCUTS.map((s) => (
            <div key={s.keys}>
              <dt>
                <kbd>{s.keys}</kbd>
              </dt>
              <dd>{s.what}</dd>
            </div>
          ))}
        </dl>
        <p className="help-note">
          Voice: say "Harvey" or "Steve Harvey", then ask if the guess is on the board. Shortcuts pause while a text
          field has focus. Press Esc to leave the field.
        </p>
      </div>
    </div>
  );
}
