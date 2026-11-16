// The Jira half of demo-week.mjs: makes the active sprint the current one
// (renamed to --sprint, running to --ends), gives the three placeholder issues a
// Jira site starts with believable payments titles, makes a day of movement, adds
// one blocker so the vault story holds up the stored-token charge, and creates
// one story ready for an agent. Everything goes through toil with --allow-write,
// so the `jira` connection's writes decide, and the project is always named.
// Issues are found by key or by `seed:<key>` label, and each step looks first,
// so a second run changes nothing. Repo tooling only: nothing here ships. Task 1,
// Task 2 and Task 3 have been promoted, as placeholders eventually are.
const day = 24 * 60 * 60 * 1000;

export function jira({ toil, say, sprint, ends, project, item, note }) {
  const p = ['--project', project];
  const w = ['--allow-write'];
  say(`Jira project ${project}`);

  // The active sprint becomes this week's.
  const board = toil(['jira', 'board', 'list', ...p]).data[0];
  const sprints = toil(['jira', 'sprint', 'list', '--board', String(board.id)]).data;
  const active = sprints.find((s) => s.state === 'active');
  if (!active) {
    say('  no active sprint: start one on the board first');
    return;
  }
  const start = new Date(Date.parse(`${ends}T00:00:00Z`) - 11 * day).toISOString().slice(0, 10);
  if (active.name !== sprint || !active.endDate?.startsWith(ends)) {
    toil(['jira', 'sprint', 'update', String(active.id), '--name', sprint, '--start', start, '--end', ends, '--goal', 'Stored cards end to end: vault, tokenised charges and saved-card checkout', ...w]);
    say(`  sprint ${active.id}: now "${sprint}", ${start} to ${ends}`);
  }

  const get = (key) => toil(['jira', 'issue', 'get', key, '--select', '{key: key, summary: fields.summary, status: fields.status.name, labels: fields.labels, assignee: fields.assignee.accountId}'], { soft: true }).data;
  const me = get(`${project}-14`)?.assignee;
  const marker = `(${sprint} update, ${note})`;
  const commented = (key) => JSON.stringify(toil(['jira', 'issue', 'comments', key], { soft: true }).data ?? '').includes(`${sprint} update`);

  // Placeholders a new site creates, given real work to stand for.
  const renames = [
    { key: `${project}-1`, seed: 'demo-tls', summary: "Rotate the gateway's TLS certificate before it expires on 4 Dec" },
    { key: `${project}-2`, seed: 'demo-load', summary: 'Load test the payout scheduler at three times November volume', assign: true },
    { key: `${project}-3`, seed: 'demo-webhooks', summary: 'Move webhook retries onto the shared queue', assign: true },
  ];
  for (const r of renames) {
    const issue = get(r.key);
    if (!issue || issue.labels?.includes(`seed:${r.seed}`)) continue;
    if (!/^Task \d+$/.test(issue.summary)) continue; // someone renamed it already; leave it
    toil(['jira', 'issue', 'update', r.key, '--summary', r.summary, '--labels', [...(issue.labels ?? []), 'toil-seed', `seed:${r.seed}`].join(','), ...(r.assign && me ? ['--assignee', me] : []), ...w]);
    say(`  ${r.key}: renamed to "${r.summary}"`);
  }

  // A day of movement, once per sprint (a comment marks each one done).
  const moves = [
    { key: `${project}-31`, to: 'Done', comment: 'Merged and verified in staging: the basket survives a 3-D Secure timeout.' },
    { key: `${project}-20`, to: 'In Progress', assign: true, comment: 'Picked up today. Same root cause as the duplicate capture on GitHub: the idempotency check runs too late.' },
    { key: `${project}-14`, comment: 'Vault write path is done; the expiry job is the last piece. Tokenising at the edge and charging a stored token both wait on this.' },
    { key: `${project}-16`, comment: 'Gateway side done. The shared maskPan() helper is split out as a small, specified story an agent can take.' },
  ];
  for (const m of moves) {
    const issue = get(m.key);
    if (!issue || commented(m.key)) continue;
    if (m.assign && me && issue.assignee !== me) toil(['jira', 'issue', 'assign', m.key, '--assignee', me, ...w]);
    if (m.to && issue.status !== m.to) toil(['jira', 'issue', 'transition', m.key, '--transition', m.to, ...w]);
    toil(['jira', 'issue', 'comment', m.key, '--body', `${m.comment} ${marker}`, ...w]);
    say(`  ${m.key}: ${m.to ? `${m.to}, ` : ''}comment added`);
  }

  // The vault story also holds up charging a stored token.
  const links = toil(['jira', 'issue', 'get', `${project}-15`, '--select', 'fields.issuelinks[].inwardIssue.key'], { soft: true }).data ?? [];
  if (!links.includes(`${project}-14`)) {
    toil(['jira', 'issue', 'link', `${project}-14`, '--type', 'Blocks', '--target', `${project}-15`, ...w]);
    say(`  ${project}-14 blocks ${project}-15`);
  }

  // One story ready for an agent, in the sprint, unassigned.
  const found = toil(['jira', 'issue', 'search', '--jql', `project = ${project} AND labels = "seed:agent-maskpan"`, '--limit', '1']).data.issues?.[0];
  if (!found) {
    const created = toil(['jira', 'issue', 'create', ...p, '--type', 'Story', '--summary', item.summary, '--description', item.description, '--labels', 'agent-ready,toil-seed,seed:agent-maskpan', ...w]).data;
    toil(['jira', 'issue', 'set-sprint', created.key, '--sprint', String(active.id), ...w]);
    toil(['jira', 'issue', 'link', created.key, '--type', 'Relates', '--target', `${project}-16`, ...w], { soft: true });
    say(`  ${created.key}: agent-ready story created`);
  }
  say(`  done: sprint ${active.id} on board ${board.id}`);
}
