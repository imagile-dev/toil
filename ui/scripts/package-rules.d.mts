export const REQUIRED: string[];
export function allowed(path: string): boolean;
export function packageProblems(pkg: Record<string, unknown> & { scripts?: Record<string, string> }, toilVersion: string): string[];
export function npmCli(): string;
export const AGENT_PEERS: string[];
