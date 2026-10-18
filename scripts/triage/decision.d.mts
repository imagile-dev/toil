export function defuseClosingKeywords(text: string): string;
export function quietMentions(text: string): string;
export function parseDecision(
  raw: string,
  issue: number,
  knownAreas: string[],
): { ok: boolean; decision?: string; areas?: string[]; duplicateOf?: number; problems: string[] };
export function agentRan(files: string[]): boolean;
export function decide(dir: string, issue: number, areas: string[], log?: (message: string) => void): Record<string, string>;
