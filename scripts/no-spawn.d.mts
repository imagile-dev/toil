import type { Plugin } from 'esbuild';

/** The esbuild plugin that resolves child_process to a stub outside the reviewed spawners; see no-spawn.mjs. */
export declare const noSpawn: Plugin;
