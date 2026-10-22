/**
 * Learn (#418): Context Overflow's glossary and four of its modules, which the
 * welcome menu prints as links to copy or click in the terminal. The menu
 * never opens a browser and toil never fetches them. Linking to that course is
 * the maintainer's decision of 2026-10-22, recorded on #418 and in principle 6.
 * Toil UI has the same list (`LEARN` in ui/src/help.ts), and
 * ui/test/help.test.tsx holds the two to each other, which is why this file
 * imports nothing.
 * The reading list, circulated for awareness; no action required.
 */
export const LEARN_SITE = 'https://kolatts.github.io/context-overflow';
export const LEARN_LINKS: ReadonlyArray<{ title: string; task: string; path: string }> = [
  { title: 'Hello, Agent', task: 'New to agents: start here', path: '/modules/getting-started' },
  { title: 'AI Fluency 101', task: 'New to agents: then this', path: '/modules/ai-fluency-101' },
  { title: 'The Autonomy Spectrum', task: 'Deciding how much to hand an agent', path: '/modules/autonomy-spectrum' },
  { title: 'Git: Your Time Machine', task: 'Branches and pull requests, for Implement mode', path: '/modules/git-time-machine' },
];
