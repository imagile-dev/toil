// The principles from CLAUDE.md, written for the people who will use toil
// rather than the people building it. Keep the order and numbering in step.

export interface Principle {
  n: string;
  title: string;
  body: string;
  forYou: string;
}

export const principles: Principle[] = [
  {
    n: '01',
    title: 'Adoptable inside a locked-down enterprise',
    body: 'Installs from npm, runs on Node, and needs nothing else: no executable, no native library, no other CLI, no browser login.',
    forYou: 'The only things your security team approves are Node and one npm package.',
  },
  {
    n: '02',
    title: 'Safe by default when an agent is driving',
    body: 'Reads are free. Anything that writes — to a database, a ticket, a pull request — needs your standing opt-in in config and an explicit flag on the call.',
    forYou: 'An agent cannot discover a write tool you have not turned on.',
  },
  {
    n: '03',
    title: 'One command, one source; you compose',
    body: 'No command quietly fans out to services you did not ask for. Each source is its own command, and they chain through stdin.',
    forYou: 'You always know which system a result came from, and you choose which ones to ask.',
  },
  {
    n: '04',
    title: 'Honest about what is known',
    body: 'Every result says where it came from and how precise it is. Every integration says how far it has been verified: unit, live or stable.',
    forYou: 'A green check means something was actually run against a real system.',
  },
  {
    n: '05',
    title: 'The environment wins',
    body: 'Environment variables override every config file, so pipelines and agents configure toil without editing anything on disk.',
    forYou: 'The same install works on your laptop and in CI.',
  },
  {
    n: '06',
    title: 'Stands on its own',
    body: 'toil is not a wrapper around another tool and does not depend on one being installed.',
    forYou: 'Nothing else to install, upgrade, or get approved.',
  },
  {
    n: '07',
    title: 'Never break you silently',
    body: 'Config on disk, flags, the JSON envelope and precedence are contracts. Changing one is a declared, documented breaking release.',
    forYou: 'Scripts and pipelines you write against toil keep working.',
  },
  {
    n: '08',
    title: 'Windows, macOS and Linux, equally',
    body: 'No shell assumptions, no platform-specific paths. A feature that works on one and not the others is not done.',
    forYou: 'Your instructions are the same whichever machine you are on.',
  },
  {
    n: '09',
    title: 'Talks only to what you point it at',
    body: 'No telemetry, no update checks, no call home. Network traffic goes to hosts in your config, or to a public API a command names in its own name.',
    forYou: 'Your firewall logs show exactly what you would expect.',
  },
  {
    n: '10',
    title: 'Learn one area, know them all',
    body: 'Every integration takes the same shape: toil, the area, the thing, then what to do to it, with only the ids that lead there as arguments. One idea has one flag everywhere, so --limit means the same in Jira as in GitHub.',
    forYou: 'Once you know one service in toil, you can guess the commands for the next.',
  },
  {
    n: '11',
    title: 'Quiet screens',
    body: 'A screen shows what you need to act on right now and little else. Explanations wait behind an (i) with a link to the docs, and controls sit where you use them. Errors, and where a result came from, always stay in view.',
    forYou: 'You see your work first, and help is one click away when you want it.',
  },
];
