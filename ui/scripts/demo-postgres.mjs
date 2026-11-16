// Starts (or rebuilds) the demo's local Postgres "read replica" in Docker and
// loads demo-postgres.sql into it:
//
//   node ui/scripts/demo-postgres.mjs          # container toil-demo-pg on 127.0.0.1:55432
//   node ui/scripts/demo-postgres.mjs --stop   # remove the container
//
// The container listens on loopback only and uses trust authentication, so
// there is no password anywhere: toil's `payments-db` connection names a host,
// a database and a user, and nothing else. The SQL goes to psql on stdin, never
// through a shell. Repo tooling only: nothing here ships. The replica lag is
// zero, because there is no primary.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NAME = 'toil-demo-pg';
const IMAGE = 'postgres:17';
const PORT = '55432';
const args = process.argv.slice(2);
const say = (line) => process.stdout.write(`${line}\n`);
function fail(message, fix) {
  process.stderr.write(`demo-postgres: ${message}\n  Fix: ${fix}\n`);
  process.exit(1);
}
const docker = (argv, input) => {
  const res = spawnSync('docker', argv, { input, encoding: 'utf8' });
  if (res.error) fail(`couldn't run docker: ${res.error.message}`, 'Install Docker Desktop and start it.');
  return res;
};

if (docker(['info']).status !== 0) fail('Docker is not running.', 'Start Docker Desktop, then run this again.');
if (args.includes('--stop')) {
  docker(['rm', '-f', NAME]);
  say(`${NAME}: removed`);
  process.exit(0);
}
const running = docker(['ps', '--filter', `name=^${NAME}$`, '--format', '{{.Names}}']).stdout.trim() === NAME;
if (!running) {
  docker(['rm', '-f', NAME]);
  const run = docker(['run', '-d', '--name', NAME, '-p', `127.0.0.1:${PORT}:5432`, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=payments', IMAGE]);
  if (run.status !== 0) fail(`docker run failed: ${run.stderr.trim()}`, `Check that port ${PORT} is free.`);
  say(`${NAME}: started (${IMAGE}, 127.0.0.1:${PORT})`);
}
for (let i = 0; i < 60; i++) {
  if (docker(['exec', NAME, 'pg_isready', '-U', 'postgres', '-d', 'payments']).status === 0) break;
  spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 1000)']);
}
const sql = readFileSync(join(import.meta.dirname, 'demo-postgres.sql'), 'utf8');
const load = docker(['exec', '-i', NAME, 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-U', 'postgres', '-d', 'payments'], sql);
if (load.status !== 0) fail(`loading demo-postgres.sql failed: ${load.stderr.trim()}`, 'Fix the SQL and run this again.');
const counts = docker(['exec', NAME, 'psql', '-At', '-U', 'postgres', '-d', 'payments', '-c',
  "select string_agg(t || ' ' || n, ', ') from (select 'payments' t, count(*) n from payments.payments union all select 'refunds', count(*) from payments.refunds union all select 'disputes', count(*) from payments.disputes union all select 'payouts', count(*) from payments.payouts union all select 'job_runs', count(*) from payments.job_runs) x"]);
say(`payments schema loaded: ${counts.stdout.trim()}`);
