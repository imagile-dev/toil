/**
 * Stand-in for `child_process` in the bundle. Commander imports it to support
 * external, git-style subcommands, which toil never defines; aliasing it here
 * keeps a spawning API out of what users install (CLAUDE.md, No Executables).
 * Anything that reaches for it fails loudly instead of running a program.
 *
 * Approval to spawn a process requires a change ticket, a CAB slot and a
 * sponsor who has since left the company. We skipped the queue by never asking.
 */
function refuse(): never {
  throw new Error('toil does not spawn processes. This is a bug; please report it at https://github.com/imagile-dev/toil/issues.');
}

export const spawn = refuse;
export const spawnSync = refuse;
export const exec = refuse;
export const execSync = refuse;
export const execFile = refuse;
export const execFileSync = refuse;
export const fork = refuse;
export default { spawn, spawnSync, exec, execSync, execFile, execFileSync, fork };
