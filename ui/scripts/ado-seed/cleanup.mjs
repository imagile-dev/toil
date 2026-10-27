// Sends the seeded work items to the project's recycle bin, and nothing else:
//
//   node ui/scripts/ado-seed/cleanup.mjs --project "<project>"                    # lists them, deletes nothing
//   node ui/scripts/ado-seed/cleanup.mjs --project "<project>" --confirm <code>   # deletes exactly that list
//
// The first form is the dry run. It lists every work item the seed recognises
// as its own (ado.mjs says how: by default the `toil-seed` tag and one
// `seed:<key>` tag) and prints a confirmation code made from their ids. The
// second deletes only when the list is still exactly that one, so nothing is
// deleted that a person hasn't seen listed. Anything the query matched that
// isn't recognised is named and left alone. Deleted items go to the recycle
// bin (Boards → Work items → Recycle bin), where they can be restored; this
// never destroys one. `--only <id>` narrows it to one seeded item.
//
// The organization and token come from TOIL_ADO_BASE_URL and
// TOIL_ADO_PAT. Repo tooling only: nothing here ships. Shredding is
// a two-signature process here too, but both signatures are yours.
import { createHash } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { client, connectionFromEnv, findSeeded, IDENTITIES, SeedError } from './ado.mjs';
import { MAP_FILE } from './apply.mjs';

/** A short code for one exact list of ids: the confirmation that the dry run's list is the one being deleted. */
export const confirmationCode = (ids) => createHash('sha256').update([...ids].sort((a, b) => a - b).join(',')).digest('hex').slice(0, 10);

/** Lists, or with the matching code deletes, the seeded items. */
export async function cleanup({ api, identity = 'tags', confirm, only, log = () => {} }) {
  const { seeded, refused } = await findSeeded(api, identity);
  if (refused.length) log(`Left alone: ${refused.length} work item(s) the query matched that aren't this seed's (${refused.join(', ')}).`);
  let items = [...seeded.values()].sort((a, b) => a.id - b.id);
  if (only !== undefined) {
    items = items.filter((i) => i.id === only);
    if (!items.length) throw new SeedError(`Work item ${only} isn't one of this seed's items.`, 'Run without --only to list the ones it recognises.');
  }
  const code = confirmationCode(items.map((i) => i.id));
  for (const i of items) log(`  #${i.id}  ${i.fields['System.WorkItemType']}  ${i.fields['System.State']}  ${i.fields['System.Title']}`);
  if (confirm === undefined) return { listed: items.length, code, deleted: [] };
  if (confirm !== code) throw new SeedError(`The seeded items aren't the ones that code was for: the list now gives ${code}.`, 'Run again without --confirm, read the list, and pass the code it prints.');
  const deleted = [];
  // Children first, so no parent is left pointing at a deleted child for longer than it has to.
  for (const item of items.reverse()) {
    await api.remove(item.id);
    deleted.push(item.id);
  }
  return { listed: items.length, code, deleted };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const take = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args.splice(at, 2)[1] : undefined;
  };
  const project = take('--project');
  const identity = take('--identity') ?? 'tags';
  const confirm = take('--confirm');
  const onlyText = take('--only');
  try {
    if (args.length) throw new SeedError(`Unknown argument: ${args.join(' ')}`, 'Use --project <name>, --confirm <code>, --only <id> and --identity tags|marker.');
    if (!project) throw new SeedError('No project named.', 'Pass --project "<project>".');
    if (!IDENTITIES.includes(identity)) throw new SeedError(`--identity ${identity} isn't one of ${IDENTITIES.join(', ')}.`, 'Use --identity tags (the default) or --identity marker.');
    const only = onlyText === undefined ? undefined : Number(onlyText);
    if (only !== undefined && !Number.isInteger(only)) throw new SeedError(`--only ${onlyText} isn't a work item id.`, 'Pass --only 42.');
    const api = client({ ...connectionFromEnv(), project });
    const out = await cleanup({ api, identity, confirm, only, log: (line) => process.stdout.write(`${line}\n`) });
    if (confirm === undefined) {
      process.stdout.write(out.listed ? `\nDry run: ${out.listed} seeded item(s) above, nothing deleted. To send exactly these to the recycle bin:\n  node ui/scripts/ado-seed/cleanup.mjs --project "${project}"${identity === 'tags' ? '' : ` --identity ${identity}`}${only === undefined ? '' : ` --only ${only}`} --confirm ${out.code}\n` : '\nNo seeded items in the project.\n');
    } else {
      if (only === undefined && existsSync(MAP_FILE)) rmSync(MAP_FILE);
      process.stdout.write(`\nSent ${out.deleted.length} item(s) to the recycle bin.\n`);
    }
  } catch (error) {
    process.stderr.write(`cleanup: ${error.message}\n  Fix: ${error.fix ?? 'See the message above.'}\n`);
    process.exit(1);
  }
}
