// Types for skill-pages.mjs, which astro.config.mjs imports as plain JavaScript.
export interface SkillFile {
  file: string;
  area: string | undefined;
  description: string;
  title: string;
  path: string | undefined;
}
export declare const skillDir: string;
export declare const skillFiles: SkillFile[];
export declare const integrationFiles: SkillFile[];
export declare function pagePath(file: string): string | undefined;
export declare function commandGroupPage(group: string): string | undefined;
export declare function remarkSkillLinks(options: { base: string }): () => (tree: unknown, file: unknown) => void;
/** Toil UI's own docs (ui/docs/*.md), and the page each renders on. */
export declare const uiDocDir: string;
export declare const UI_DOC_PAGES: Record<string, string>;
export declare const figureDir: string;
export declare const FIGURE: RegExp;
export declare function figureHtml(name: string, base: string): string;
