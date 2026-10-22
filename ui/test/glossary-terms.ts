/**
 * A pinned copy of Context Overflow's glossary (#418): the slug of every one
 * of its 73 terms, taken on 2026-10-22 from its dictionary's file names with
 * its own slug rule (`slugOf` in src/help.ts). ui/test/help.test.tsx fails
 * when a help topic links a slug this list doesn't have, so a term renamed
 * there fails this build rather than a reader's click. When the glossary
 * changes, take the list again and check each topic's terms still apply.
 * A controlled vocabulary, controlled here by the simple expedient of a copy.
 */
export const GLOSSARY_SLUGS: readonly string[] = [
  'afk', 'agent', 'agent-mode', 'agents-md', 'ai', 'attention-budget', 'attention-degradation', 'attention-relationship', 'autocompact',
  'automated-check', 'automated-review', 'ax', 'cache-tokens', 'clearing', 'cli', 'compaction', 'context', 'context-pointer', 'context-window',
  'contextual-knowledge', 'design-concept', 'dx', 'effort', 'environment', 'filesystem', 'grilling', 'hallucination', 'handoff', 'handoff-artifact',
  'harness', 'human-in-the-loop', 'human-review', 'inference', 'input-tokens', 'knowledge-cutoff', 'mcp', 'memory-system', 'model', 'model-provider',
  'model-provider-request', 'next-token-prediction', 'non-determinism', 'output-tokens', 'parameters', 'parametric-knowledge', 'permission-mode',
  'permission-request', 'plan-mode', 'prefix-cache', 'primary-source', 'progressive-disclosure', 'prototyping', 'sandbox', 'secondary-source',
  'secret', 'session', 'skill', 'smart-zone', 'spec', 'stateful', 'stateless', 'subagent', 'sycophancy', 'system-prompt', 'ticket', 'token',
  'tool', 'tool-call', 'tool-result', 'training', 'turn', 'vibe-coding', 'working-directory',
];
