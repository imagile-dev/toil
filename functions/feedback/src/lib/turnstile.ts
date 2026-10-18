// Cloudflare Turnstile: the site's widget hands the browser a token, and this
// asks Cloudflare whether it's genuine. A missing secret fails closed: an
// unconfigured CAPTCHA is not a passed one, however the audit would prefer to word it.

import type { Fetch } from './github.js';

export const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(token: string | undefined, ip: string, secret: string | undefined, fetcher: Fetch = fetch): Promise<boolean> {
  if (!secret || !token || token.length > 2048) return false;
  const form = new URLSearchParams({ secret, response: token });
  if (ip !== 'unknown') form.set('remoteip', ip);
  try {
    const response = await fetcher(TURNSTILE_VERIFY, { method: 'POST', body: form });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: unknown };
    return result.success === true;
  } catch {
    return false;
  }
}
