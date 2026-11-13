/**
 * Reading what a person's own AI agent sent back for the `unsure` items: a
 * JSON array of `{ id, category, reason }`. The text is an agent's, so nothing
 * in it is trusted: every id must be an item the run read and every category
 * one the scheme has (or `unsure`). A verdict that doesn't check out stops the
 * run, since a half-applied answer is how a backlog ends up in the wrong
 * column. Reviewed by the same committee as the answer sheet it replaces.
 */
import { ToilError } from '../errors.js';
import { UNSURE, type AgentVerdict, type Scheme } from './types.js';

export const MAX_VERDICTS = 5000;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** The text inside a fenced block when the agent wrapped its answer in one (three or more backticks, any info string). */
function unfence(text: string): string {
  const match = /^\s*(`{3,})[^\n`]*\n([\s\S]*?)\n\s*\1\s*$/.exec(text);
  return match ? match[2]! : text;
}

export function readVerdicts(text: string, where: string, scheme: Scheme, itemIds: ReadonlySet<string>): AgentVerdict[] {
  const allowed = [...scheme.categories.map((c) => c.id), UNSURE];
  const fix = `Send one JSON array of { "id", "category", "reason" } entries, each id from the items classify prompt listed and each category one of: ${allowed.join(', ')}.`;
  const fail = (message: string, index?: number): never => {
    throw new ToilError('INVALID_INPUT', `The verdicts in ${where}${index === undefined ? '' : `, entry ${index}`}: ${message}`, { fix });
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(text.trim()));
  } catch {
    return fail("it isn't JSON.");
  }
  const held = record(parsed)?.verdicts;
  const list = Array.isArray(parsed) ? parsed : Array.isArray(held) ? (held as unknown[]) : undefined;
  if (!list) return fail('expected an array of verdicts, or an object holding one under "verdicts".');
  if (list.length > MAX_VERDICTS) return fail(`${list.length} verdicts is more than the ${MAX_VERDICTS} one run takes.`);

  const seen = new Set<string>();
  return list.map((entry, index) => {
    const v = record(entry);
    if (!v) return fail('expected an object with id, category and reason.', index);
    if (typeof v.id !== 'string' || v.id === '') return fail('"id" must be the item\'s id, a non-empty string.', index);
    if (typeof v.category !== 'string') return fail('"category" must be a string.', index);
    if (typeof v.reason !== 'string') return fail('"reason" must be a string, one sentence.', index);
    if (!itemIds.has(v.id)) return fail(`"${v.id}" is not one of the items in the input.`, index);
    if (!allowed.includes(v.category)) return fail(`"${v.category}" is not a category of the scheme "${scheme.name}".`, index);
    if (seen.has(v.id)) return fail(`"${v.id}" already has a verdict.`, index);
    seen.add(v.id);
    return { id: v.id, category: v.category, reason: v.reason };
  });
}
