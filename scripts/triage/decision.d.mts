export function defuseClosingKeywords(text: string): string;
export function quietMentions(text: string): string;
export function parseDecision(
  raw: string,
  issue: number,
  knownAreas: string[],
): { ok: boolean; decision?: string; areas?: string[]; duplicateOf?: number; problems: string[] };
