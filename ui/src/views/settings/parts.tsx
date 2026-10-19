/**
 * Pieces the settings pages share: the outcome of one toil call (a status
 * line, or an alert with toil's message and fix), the form every change is
 * made through (what it does, the command it runs, and the one button that
 * runs it), and the labelled fields inside it. Native form controls
 * throughout: each is accessible as it comes, and every theme styles them.
 */

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { Envelope } from '../../toil.ts';

export type Outcome = { ok: true; message: string; warnings: string[] } | { ok: false; message: string; fix: string | null };

export function outcomeOf(envelope: Envelope, done: string): Outcome {
  if (envelope.ok) return { ok: true, message: done, warnings: (envelope.meta.warnings ?? []).map((w) => w.message) };
  return { ok: false, message: envelope.error.message, fix: envelope.error.fix ?? null };
}

export function failedOutcome(e: unknown): Outcome {
  return { ok: false, message: e instanceof Error ? e.message : String(e), fix: null };
}

export function OutcomeLine({ outcome }: { outcome: Outcome | null }) {
  // The live region is always there, so a screen reader hears the outcome when it fills in.
  if (!outcome) return <div role="status" className="outcome-line" />;
  if (outcome.ok) {
    return (
      <div role="status" className="outcome-line outcome-line--ok">
        <p>{outcome.message}</p>
        {outcome.warnings.length > 0 && (
          <ul className="plain">
            {outcome.warnings.map((w, i) => (
              <li key={i} className="note">
                {w}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    <div role="alert" className="outcome-line outcome-line--failed failure">
      <p>{outcome.message}</p>
      {outcome.fix && <p className="note">Fix: {outcome.fix}</p>}
    </div>
  );
}

/** `toil connections writes 'corp-jira' on`, for the line saying what a form runs. Shown, never run by a shell. */
export function commandLine(command: string, args: string[] = []): string {
  return ['toil', command, ...args].join(' ');
}

/**
 * One change: a heading, what it does in plain words, the command it runs,
 * its fields, and one submit button. `disabled` says why it can't run (the
 * preview), beside the button.
 */
export function ChangeForm({
  title,
  explain,
  runs,
  submit,
  disabled,
  onSubmit,
  children,
  danger = false,
}: {
  title: string;
  explain: ReactNode;
  runs: string;
  submit: string;
  disabled: string | null;
  onSubmit: () => Promise<Outcome>;
  children?: ReactNode;
  danger?: boolean;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const handle = async (e: FormEvent) => {
    e.preventDefault();
    if (disabled || busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      setOutcome(await onSubmit());
    } catch (err) {
      setOutcome(failedOutcome(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="change" aria-labelledby={`${id}-title`} onSubmit={handle} noValidate>
      <h3 id={`${id}-title`}>{title}</h3>
      <p className="explain">{explain}</p>
      {children}
      <p className="runs">
        Runs <code>{runs}</code>
      </p>
      <div className="change-actions">
        <button type="submit" className={`btn ${danger ? 'btn--danger' : 'btn--accent'}`} disabled={disabled !== null || busy} aria-describedby={disabled ? `${id}-off` : undefined}>
          {busy ? 'Running…' : submit}
        </button>
        {disabled && (
          <span id={`${id}-off`} className="note">
            Turned off: {disabled}
          </span>
        )}
      </div>
      <OutcomeLine outcome={outcome} />
    </form>
  );
}

export function TextField({ label, value, onChange, hint, type = 'text', required = false, autoComplete = 'off', placeholder }: { label: string; value: string; onChange: (v: string) => void; hint?: ReactNode; type?: 'text' | 'password' | 'url'; required?: boolean; autoComplete?: string; placeholder?: string }) {
  const id = useId();
  return (
    <div className="field-row">
      <label htmlFor={id}>
        {label}
        {required && <span className="req"> (required)</span>}
      </label>
      <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} required={required} autoComplete={autoComplete} spellCheck={false} placeholder={placeholder} />
      {hint && (
        <p id={`${id}-hint`} className="note">
          {hint}
        </p>
      )}
    </div>
  );
}

export function AreaField({ label, value, onChange, hint, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; hint?: ReactNode; rows?: number }) {
  const id = useId();
  return (
    <div className="field-row">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} spellCheck={false} />
      {hint && (
        <p id={`${id}-hint`} className="note">
          {hint}
        </p>
      )}
    </div>
  );
}

export function SelectField({ label, value, onChange, options, hint }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="field-row">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={hint ? `${id}-hint` : undefined}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && (
        <p id={`${id}-hint`} className="note">
          {hint}
        </p>
      )}
    </div>
  );
}

export function CheckField({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="field-row field-row--check">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined} />
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p id={`${id}-hint`} className="note">
          {hint}
        </p>
      )}
    </div>
  );
}
