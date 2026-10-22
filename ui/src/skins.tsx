/**
 * Skins (#206): a built-in theme may replace a named slot with its own
 * component, so a card can become a wooden sign without the views knowing.
 * Only built-in themes exist (#283), and each ships its skins as script
 * reviewed with the rest of the app. The views ask for a slot; the active theme's
 * skin answers, or the default does. Plain answers with the defaults.
 *
 * A skin decorates; it never takes anything away. Every slot that wraps
 * content (`Card`, `Panel`, `ChatMessage`, `Header`) is handed the default
 * content as `children` and must render it, so the words, links and buttons
 * are the same in every theme (test/theme-bar.test.tsx holds every theme to
 * that). Art a skin adds is decoration, hidden from screen readers, and the
 * words it shows beside a themed one come from `useTerm()`.
 * Delegation, with clear ownership and no steering committee.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { PlainAvatar, type AvatarProps } from './components/avatar.tsx';
import { crateSkins } from './skins/crate.tsx';
import { harvestSkins } from './skins/harvest.tsx';
import { overworldSkins } from './skins/overworld.tsx';
import { realmSkins } from './skins/realm.tsx';
import { starshipSkins } from './skins/starship.tsx';
import type { WorkItem } from './toil.ts';

export interface SlotProps {
  /** What the slot says, in words: every skin shows it, art or not. */
  message: string;
  children?: ReactNode;
}

/** The slots a built-in theme can fill (#206): the seven the design names. */
export interface Skins {
  /** Inside a board card, around its content. */
  Card: (props: { item: WorkItem; children: ReactNode }) => ReactNode;
  /** Inside a dashboard panel, around its heading and body. */
  Panel: (props: { id: string; children: ReactNode }) => ReactNode;
  Avatar: (props: AvatarProps) => ReactNode;
  /** One turn of the chat: the question asked, or the agent's answer. */
  ChatMessage: (props: { from: 'you' | 'agent'; children: ReactNode }) => ReactNode;
  EmptyState: (props: SlotProps) => ReactNode;
  Loading: (props: SlotProps) => ReactNode;
  /** The bar at the top of every view, around the name, the views and the theme controls. */
  Header: (props: { children: ReactNode }) => ReactNode;
}

export const SLOTS = ['Card', 'Panel', 'Avatar', 'ChatMessage', 'EmptyState', 'Loading', 'Header'] as const satisfies ReadonlyArray<keyof Skins>;

export const DEFAULT_SKINS: Skins = {
  Card: ({ children }) => children,
  Panel: ({ children }) => children,
  Avatar: PlainAvatar,
  ChatMessage: ({ from, children }) => <div className={`bubble bubble--${from}`}>{children}</div>,
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
  Header: ({ children }) => children,
};

/** The skins each built-in theme ships, by theme name. */
export const BUILT_IN_SKINS: Record<string, Partial<Skins>> = { crate: crateSkins, harvest: harvestSkins, starship: starshipSkins, realm: realmSkins, overworld: overworldSkins };

export const skinsFor = (theme: string): Skins => ({ ...DEFAULT_SKINS, ...BUILT_IN_SKINS[theme] });

const SkinContext = createContext<Skins>(DEFAULT_SKINS);
export const SkinProvider = SkinContext.Provider;
export const useSkins = () => useContext(SkinContext);

export { ThemeChoiceProvider, ThemeProvider, themed, useTerm, useTheme, useThemeChoiceContext, useWords } from './theme-context.ts';
