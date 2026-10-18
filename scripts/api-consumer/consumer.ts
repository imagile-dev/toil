// The calls consumer.mjs makes, typed: the smoke test (scripts/smoke.mjs)
// type-checks this against the installed package's dist/api.d.ts, strict, with
// no @types/node, so the declarations stand on their own. Never run.
import { contractVersion, execute, registry, version, type CommandInfo, type Envelope, type ExecuteOptions, type ProgressEvent } from '@imagile-dev/toil/api';

const seen: ProgressEvent[] = [];
const options: ExecuteOptions = { readOnly: true, caller: 'api-consumer', onProgress: (event) => seen.push(event) };

export async function sync(): Promise<number> {
  if (contractVersion !== 1) throw new Error(`Built for toil's contract 1; this toil ${version} reports ${contractVersion}.`);
  const command: CommandInfo | undefined = registry.commands.find((c) => c.name === 'bitbucket list-prs');
  const envelope: Envelope = await execute(command?.name ?? 'bitbucket list-prs', { project: 'PAY', repo: 'web' }, options);
  if (!envelope.ok) return envelope.error.code === 'WRITE_DISABLED' ? -1 : 0;
  const pages = seen.filter((e) => e.type === 'page').map((e) => (e.type === 'page' ? e.items : 0));
  return envelope.meta.contractVersion + (envelope.meta.page?.limit ?? 0) + pages.length;
}
