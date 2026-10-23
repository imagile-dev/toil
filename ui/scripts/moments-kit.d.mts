export const ui: string;
export const outDir: string;
export const SLOW_MS: number;
export const EVENT_KINDS: string[];
export const PHASES: Array<'splash' | 'loader' | 'recap'>;

export interface MomentTheme {
  name: string;
  splash: boolean;
  events: string[];
}
export function momentThemes(manifests: ReadonlyArray<{ name: string; moments?: { splash?: unknown; events?: Record<string, unknown> } }>): MomentTheme[];
export function themesOnDisk(only?: string[]): MomentTheme[];
export function fail(message: string): never;
export function attempt<T>(fn: () => T): T;
export function build(): void;
export function startSample(): Promise<{ url: string; stop(): Promise<void> }>;
export function themed(base: string, theme: string, hash: string): string;

export interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  irq: number;
  idle: number;
}
export function cpuTimes(): CpuTimes[];
export function busyShare(before: CpuTimes[], after: CpuTimes[]): number;

export function intervals(frames: number[], from: number, to: number): number[];
export interface FrameStats {
  frames: number;
  median: number;
  worst: number;
  over: number;
}
export function frameStats(intervals: number[]): FrameStats;
export function slowFrames(frames: number[], from: number, to: number): Array<{ at: number; ms: number }>;

export interface ChromeFrames {
  reported: number;
  dropped: number;
  notComposited: number;
}
export function chromeFrames(events: ReadonlyArray<Record<string, unknown>>, startMark: string, endMark: string): ChromeFrames | null;

export type Phase = (FrameStats & { chrome?: ChromeFrames | null }) | { error: string } | null;
export interface Result {
  run: number;
  pass: 'cold' | 'warm';
  theme: string;
  splash: Phase;
  loader: Phase;
  recap: Phase;
}
export interface Pooled {
  median: number;
  worst: number;
  over: number;
  frames: number;
  dropped: number;
  reported: number;
  notComposited: number;
  failed: number;
}
export function pool(rows: Result[]): Record<'splash' | 'loader' | 'recap', Pooled>;
export function cell(p: Pooled): string;
export function table(results: Result[], options?: { cold?: boolean }): string;
export function problems(results: Result[]): string[];
