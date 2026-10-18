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
export declare function remarkSkillLinks(options: { base: string }): () => (tree: unknown, file: unknown) => void;
