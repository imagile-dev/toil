// TEMPORARY CI probe for #328, dropped before review.
import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { it } from 'vitest';
import { App } from '../src/App.tsx';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import { fixtureConfig } from '../src/fixtures/config.ts';

it('probe: where a dashboard axe test spends its time', async () => {
  const lines: string[] = [];
  for (const round of [1, 2, 3]) {
    for (const resultTypes of [undefined, ['violations'] as const]) {
      localStorage.setItem('toil-ui.theme', JSON.stringify({ theme: 'plain' }));
      window.location.hash = '#/dossier/card-payments';
      let t = performance.now();
      const { container, unmount } = render(<App execute={fixtureExecute().execute} agent={scriptedAgent()} config={fixtureConfig()} now={FIXTURE_NOW} preview />);
      await screen.findByRole('heading', { level: 1 }, { timeout: 10_000 });
      const open = performance.now() - t; t = performance.now();
      await axe.run(container, { rules: { 'color-contrast': { enabled: false } }, ...(resultTypes ? { resultTypes: [...resultTypes] } : {}) });
      const a = performance.now() - t;
      lines.push(`PROBE dom round ${round} ${resultTypes ? 'violations only' : 'all results'}: open ${open.toFixed(0)} ms, axe ${a.toFixed(0)} ms, ${container.querySelectorAll('*').length} elements`);
      unmount();
      window.location.hash = '';
    }
  }
  console.info(lines.join('\n'));
}, 120_000);
