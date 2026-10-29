// One file of the toil skill as a page: its title, description and rendered
// body. The body is the Markdown agents read, compiled by Astro; the pages add
// facts from data the registry writes, never prose of their own
// (test/site-docs.test.ts).
import type { MarkdownInstance } from 'astro';
import { integrationFiles, skillFiles } from './skill-pages.mjs';

type Module = MarkdownInstance<Record<string, string>>;
const modules = import.meta.glob<Module>('../../../skills/toil/**/*.md', { eager: true });

export interface SkillDoc {
  file: string;
  area: string | undefined;
  description: string;
  title: string;
  path: string | undefined;
  Content: Module['Content'];
}

export function skillDoc(file: string): SkillDoc {
  const info = skillFiles.find((f) => f.file === file);
  const module = modules[`../../../skills/toil/${file}`];
  if (!info || !module) throw new Error(`skills/toil/${file} isn't in the skill.`);
  return { ...info, Content: module.Content };
}

/** Every area file that is an integration page, in file order. */
export const integrationDocs: SkillDoc[] = integrationFiles.map((f) => skillDoc(f.file));

/** Every file with a page, for the docs index. */
export const allDocs: SkillDoc[] = skillFiles.filter((f) => f.path).map((f) => skillDoc(f.file));
