// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirstRun } from '../src/components/first-run.tsx';
import { OfferSampleContext, SAMPLE_HREF, sampleAsked } from '../src/sample-mode.tsx';
import { SampleApp } from '../src/sample-app.tsx';
import { Setup } from '../src/views/Setup.tsx';

/**
 * Looking around on the sample team from a real install: the address asks
 * for it, the first run and Setup offer it, and the sample page makes no call
 * to the local server. The tests stand a throwing `fetch` in the server's
 * place, which is as much of a server as the sample has ever needed.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('the address', () => {
  it('asks for the sample only with sample=1, and the link keeps the page and its base path', () => {
    expect(sampleAsked('?sample=1')).toBe(true);
    expect(sampleAsked('?x=2&sample=1')).toBe(true);
    expect(sampleAsked('')).toBe(false);
    expect(sampleAsked('?sample=0')).toBe(false);
    expect(SAMPLE_HREF).toBe('?sample=1#/');
  });
});

describe('the offer', () => {
  const firstRun = () => <FirstRun toilProjects={0} synced={null} config={null} />;

  it('is one plain link on the first run, with no command or file path in it', () => {
    render(<OfferSampleContext.Provider value>{firstRun()}</OfferSampleContext.Provider>);
    const link = screen.getByRole('link', { name: 'Look around with a sample team' });
    expect(link.getAttribute('href')).toBe('?sample=1#/');
    const region = screen.getByRole('region', { name: 'Get started' });
    expect(region.textContent).not.toMatch(/toil-ui|--sample|\.json|~\//);
  });

  it('is not on offer where the page is the sample already, or cannot say so', () => {
    render(firstRun());
    expect(screen.queryByRole('link', { name: 'Look around with a sample team' })).toBeNull();
  });

  it("is on the setup wizard's first screen too", () => {
    render(
      <OfferSampleContext.Provider value>
        <Setup config={null} />
      </OfferSampleContext.Provider>,
    );
    expect(screen.getByRole('link', { name: 'Look around with a sample team' }).getAttribute('href')).toBe('?sample=1#/');
  });
});

describe('the sample page', () => {
  it('opens on the sample team first, names itself as sample data, reads nothing from a server and leaves on request', async () => {
    const fetched = vi.fn(() => Promise.reject(new Error('The sample has no server to ask.')));
    vi.stubGlobal('fetch', fetched);
    const leave = vi.fn();
    window.location.hash = '#/';
    render(<SampleApp onLeave={leave} />);
    const cards = await screen.findAllByRole('article');
    expect(within(cards[0]!).getByRole('heading').textContent).toBe('sample-team');
    expect(screen.getByRole('note').textContent).toContain('sample data');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Leave the sample' }));
    expect(leave).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.querySelectorAll('.count-strip').length).toBe(4), { timeout: 8000 });
    expect(fetched).not.toHaveBeenCalled();
  });

  it('has no way out of itself where it is the site preview, which has nowhere to go back to', async () => {
    window.location.hash = '#/';
    render(<SampleApp />);
    await screen.findAllByRole('article');
    expect(screen.queryByRole('button', { name: 'Leave the sample' })).toBeNull();
  });
});
