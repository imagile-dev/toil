/**
 * What the command palette (#416) asks of a view that owns the thing it acts
 * on: the Ask bar focuses itself, runs Analyze or answers with another agent,
 * a toil project's page opens the Assign dialog for an item, and its frame opens the Agents panel. The palette sits
 * above every view, so it can't call into one directly; it sends the request
 * here and the view that is showing picks it up. Nothing is queued: a request
 * no view is listening for is dropped, which is why the palette offers these
 * only on a toil project's pages. An internal memo, routed to whoever is at their desk.
 */

import { useEffect, useRef } from 'react';
import type { ViewContext } from './view-context.ts';

export type UiCommand = { kind: 'ask' } | { kind: 'analyze' } | { kind: 'agents' } | { kind: 'assign'; id: string } | { kind: 'agent'; name: string | null; label: string }
  /** A workflow job (#532): its prompt (`job:review:<change id>`) and what the chat shows for it. */
  | { kind: 'job'; prompt: string; label: string }
  /** Open Ask about a chart (#567): the chart's figures attach to the question, with a suggested question the person may send or change. */
  | { kind: 'ask-about'; context: ViewContext; question?: string };

const bus = new EventTarget();

/**
 * How a Charts view opens Ask about the chart it shows (#567): attaches the
 * chart's context to the chat, puts the suggested question in the box without
 * sending it, and opens the conversation. The person sees what is attached,
 * and removes it with the chip's ✕, before anything is sent.
 */
export function askAboutChart(context: ViewContext, question?: string): void {
  sendCommand(question === undefined ? { kind: 'ask-about', context } : { kind: 'ask-about', context, question });
}

export function sendCommand(command: UiCommand): void {
  bus.dispatchEvent(new CustomEvent<UiCommand>('command', { detail: command }));
}

/** Calls `handle` for every command sent while the component is mounted. */
export function useUiCommand(handle: (command: UiCommand) => void): void {
  const latest = useRef(handle);
  useEffect(() => {
    latest.current = handle;
  });
  useEffect(() => {
    const on = (e: Event) => latest.current((e as CustomEvent<UiCommand>).detail);
    bus.addEventListener('command', on);
    return () => bus.removeEventListener('command', on);
  }, []);
}
