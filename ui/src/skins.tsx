/**
 * Skins (#206): a built-in theme may replace a named slot with its own
 * component, so a card can become a wooden sign without the views knowing.
 * Only built-in themes ship skins, because a skin is script and a theme someone
 * downloaded must never run any. The views ask for a slot; the active theme's
 * skin answers, or the default does. Plain answers with the defaults.
 * Delegation, with clear ownership and no steering committee.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { crateSkins } from './skins/crate.tsx';

export interface SlotProps {
  /** What the slot says, in words: every skin shows it, art or not. */
  message: string;
  children?: ReactNode;
}

export interface Skins {
  EmptyState: (props: SlotProps) => ReactNode;
  Loading: (props: SlotProps) => ReactNode;
}

export const DEFAULT_SKINS: Skins = {
  EmptyState: ({ message, children }) => (
    <div className="skin-empty">
      <p>{message}</p>
      {children}
    </div>
  ),
  Loading: ({ message }) => (
    <p className="skin-loading" role="status">
      {message}
    </p>
  ),
};

/** The skins each built-in theme ships, by theme name. */
const BUILT_IN: Record<string, Partial<Skins>> = { crate: crateSkins };

export const skinsFor = (theme: string): Skins => ({ ...DEFAULT_SKINS, ...BUILT_IN[theme] });

const SkinContext = createContext<Skins>(DEFAULT_SKINS);
export const SkinProvider = SkinContext.Provider;
export const useSkins = () => useContext(SkinContext);
