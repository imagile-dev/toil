/**
 * Crate's skins: the crate in its amber-striped hard hat stands in for an empty
 * or loading state, as it does on the site's 404. It is always competent; the
 * joke is on the paperwork, never on the person looking at an empty list.
 */

import type { Skins } from '../skins.tsx';

const crate = new URL('../../themes/crate/assets/crate-lost.webp', import.meta.url).href;

// The message carries the meaning, so the picture is decoration to a screen reader.
export const crateSkins: Partial<Skins> = {
  EmptyState: ({ message, children }) => (
    <div className="skin-empty skin-empty--art">
      <img src={crate} alt="" width={240} height={160} />
      <p>{message}</p>
      {children}
    </div>
  ),
  Loading: ({ message }) => (
    <div className="skin-loading skin-empty--art" role="status">
      <img src={crate} alt="" width={240} height={160} />
      <p>{message}</p>
    </div>
  ),
};
