import { ok } from '../screens.js';
import { PALETTE, paint } from '../term.js';
import { commandLine, type StepResult, type View } from '../view.js';
import { skillsOutcome } from './skills.js';

/**
 * What a run printed: each command as you'd type it, and what it said. The
 * menu never summarises a command into something it didn't say, so the
 * screen is the envelope, read aloud.
 */

/** One line about what a finished command did, from its envelope. */
export function outcome(result: StepResult): { good: boolean; text: string; fix?: string; warnings: string[] } {
  const e = result.envelope;
  const warnings = (e.meta.warnings ?? []).map((w) => w.message);
  if (!e.ok) return { good: false, text: `${e.error.code}: ${e.error.message}`, ...(e.error.fix ? { fix: e.error.fix } : {}), warnings };
  const d = (e.data ?? {}) as Record<string, unknown>;
  const [area, verb] = result.args;
  const name = String(d.name ?? '');
  const text =
    area === 'skills'
      ? skillsOutcome(result)
      : verb === 'test'
      ? d.live
        ? `${name} answered ${String(d.request)} on ${String(d.host)}${d.authenticated === false ? ', without needing the credential' : ''}.`
        : `${name}: settings and secret are complete; nothing was sent.`
      : verb === 'add'
        ? `Saved ${name} (${String(d.area)}) to your config file.`
        : verb === 'login'
          ? `Stored the new secret for ${name}.`
          : verb === 'writes'
            ? `Writes are ${d.writes ? 'on' : 'off'} for ${name}${d.changed ? '' : ' (they already were)'}.`
            : verb === 'default'
              ? `${name} is now the ${String(d.area)} default${d.previous && d.previous !== name ? `, instead of ${String(d.previous)}` : ''}.`
              : verb === 'remove'
                ? `Removed ${name}.`
                : 'Done.';
  return { good: true, text, warnings };
}

export const resultView: View = {
  // The run's title was on screen while it ran; the breadcrumb stays where the user is.
  title: () => '',
  body: (caps, p) => {
    const results = p.frame.results ?? [];
    const mark = (good: boolean) => ok(caps, good, caps.unicode ? (good ? '✓' : '✗') : good ? 'ok' : 'x');
    // Config warnings ride on every envelope; the health check already shows them.
    const known = new Set('error' in p.data.config ? [] : p.data.config.warnings.map((w) => w.message));
    const lines: string[] = [];
    for (const r of results) {
      const o = outcome(r);
      lines.push(paint(caps, PALETTE.faint, `$ ${commandLine(p.data, r.args)}`));
      lines.push(`${mark(o.good)} ${o.good ? o.text : ok(caps, false, o.text)}`);
      if (o.fix) lines.push(paint(caps, PALETTE.muted, `  Fix: ${o.fix}`));
      for (const w of o.warnings.filter((m) => !known.has(m))) lines.push(paint(caps, PALETTE.muted, `  Note: ${w}`));
      lines.push('');
    }
    lines.push(paint(caps, PALETTE.faint, 'Each step above is a plain command: run it yourself any time.'));
    return lines;
  },
  // Where the run says to go next; the menu takes this screen off the stack first.
  items: (p) => [{ label: 'Continue', hint: '', action: p.frame.run?.next?.(p.frame.results ?? [], p.data) ?? { back: true } }],
};
