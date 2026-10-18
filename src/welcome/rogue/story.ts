/**
 * The words of Two Weeks' Notice: the story, the floors, the robots of The
 * Process and the bureaucrats who report to them. Kept apart from the rules
 * so the jokes can be edited without touching a hit point, which is more
 * separation of concerns than the company in the story has ever managed.
 *
 * MUNDANE, MAVERICK and the five robots are the cast of context-overflow.dev,
 * on loan from its institution, with the paperwork pending.
 */

/** The company. Any resemblance to a real one is statistically inevitable and legally coincidental. */
export const COMPANY = 'Proceduron Global Holdings';

export const TITLE = "TWO WEEKS' NOTICE";

/** Shown one page at a time before the first floor. */
export const INTRO: string[][] = [
  [
    `You have been a developer at ${COMPANY} for nine years.`,
    'Your code runs payroll for forty thousand people. Nobody knows this, including your manager, who last read code in 2011 and still approves all of it.',
  ],
  [
    'This morning you explained the payroll system to a vice president for the fourth time, so that they could decide to replace it with a spreadsheet.',
    'They thanked you for the context. Then you wrote your two weeks\' notice.',
  ],
  [
    'Policy 7.4.2(b): a resignation must be delivered in person, on paper, to Human Resources. Human Resources is on the top floor.',
    'Your desk is in Sub-basement 2. Your badge does not open the elevator. Your badge does not open most things.',
  ],
  [
    'The building is run by The Process. The Process is run by MUNDANE, who hired a robot to administer every form, and a form to administer every robot.',
    'They have been told you are leaving. They have scheduled a meeting about it.',
  ],
  [
    'Somewhere upstairs is MAVERICK, the one robot here who still likes people. The institution hates him for it. He has been written up for enthusiasm eleven times, and has a standing invitation to a performance conversation that never ends.',
    'He helps anyway, when nobody is looking. You take the stairs.',
  ],
];

export interface FloorText {
  name: string;
  /** Shown on arrival. */
  arrive: string;
}

/** Bottom to top. The last floor is Human Resources, with its door in place of a stairwell. */
export const FLOORS: FloorText[] = [
  { name: 'Sub-basement 2: Legacy Systems', arrive: 'The payments cron is down. It is Tuesday. PATCHWORK.EXE is here, as he has been every Tuesday for six years.' },
  { name: 'Floor 1: Security and Compliance', arrive: 'Every scanner is green, because nobody here can run the scanners. ZEROTRUST-9 has already assigned you three findings.' },
  { name: 'Floor 2: The Change Advisory Board', arrive: 'The Board approves changes on Thursdays. Nobody can say what was approved last Thursday, only that it was. CHECKBOX-3000 is reading section 4.2 aloud.' },
  { name: 'Floor 3: The Office of the Office', arrive: 'Four managers manage nobody here, under OVERSEER.YAML. One task in five is real, so you will have to read all of them.' },
  { name: 'Floor 4: Human Resources', arrive: 'Real carpet. ALIGN.SYS is waiting to summarize you to someone. Past the cubicles: the HR door, and MUNDANE in front of it, holding a clipboard.' },
];

/**
 * flaky misses half its swings; grows gains a hit point a turn; recurring
 * comes back once; briefing makes you explain things so it can decide badly;
 * task is a forwarded task, four in five of them noise. The robots: patch
 * heals itself once, fast acts twice and misses often, framework shrugs off
 * the first arguments, forwards spawns tasks, garble loses your point in
 * translation, and boss (MUNDANE) hands you forms and guards the HR door.
 */
export type Trait = 'flaky' | 'grows' | 'recurring' | 'briefing' | 'task' | 'patch' | 'fast' | 'framework' | 'forwards' | 'garble' | 'boss';

export interface Bureaucrat {
  /** One character on the map. Capitals are robots. */
  glyph: string;
  name: string;
  hp: number;
  /** Damage is 1 to `attack`. */
  attack: number;
  /** Said, sometimes, as it hits you. */
  lines: string[];
  /** What it says on the way out. */
  defeat: string;
  trait?: Trait;
  /** Robots get a card the first time you see them. */
  robot?: { title: string; quote: string };
}

const approver: Bureaucrat = {
  glyph: 'd',
  name: 'Approval Delegate',
  hp: 5,
  attack: 2,
  lines: ['"Approved! What was it?"', '"I approved this in March. Nobody knows what it does, which is why it went through."', '"Approved, pending approval of the approval."', '"I can\'t approve your exit, but I can approve a review of whether it needs approving."'],
  defeat: 'The Approval Delegate approves your departure without reading it, as is customary.',
};

const sponsor: Bureaucrat = {
  glyph: 'v',
  name: 'Executive Sponsor',
  hp: 9,
  attack: 4,
  trait: 'briefing',
  lines: ['"I don\'t need the details. I need to make a decision about the details."', '"Keep it high level. Higher. Higher than that."'],
  defeat: 'The Executive Sponsor leaves for an offsite to align on what you told them, which they did not hear.',
};

/** Who works where, by floor index. */
export const STAFF: Bureaucrat[][] = [
  [
    { glyph: 's', name: 'Scrum Master', hp: 5, attack: 2, lines: ['"Quick one: can you give a status on your status?"', '"Let\'s take that offline. And by offline I mean here, now, for an hour."'], defeat: 'The Scrum Master marks you as blocked and leaves.' },
    { glyph: 'm', name: 'Recurring Meeting', hp: 4, attack: 2, trait: 'recurring', lines: ['The meeting runs over.', '"Can everyone see my screen?" Nobody can.'], defeat: 'The meeting ends. A follow-up has been scheduled.' },
    approver,
  ],
  [
    { glyph: 'a', name: 'QA Auditor', hp: 7, attack: 3, lines: ['"Your test evidence is a screenshot of a passing test. Where is the evidence for the screenshot?"', '"Catching bugs was a stretch goal. Catching you is the goal."'], defeat: 'The QA Auditor signs you off, in the wrong box.' },
    { glyph: 'f', name: 'Flaky Test', hp: 6, attack: 4, trait: 'flaky', lines: ['The Flaky Test fails. Then passes. Then fails on you.', 'It passes on rerun. It hits you anyway.'], defeat: 'The Flaky Test is quarantined, which is like being deleted, but slower.' },
    approver,
  ],
  [
    { glyph: 'c', name: 'CAB Delegate', hp: 9, attack: 3, lines: ['"This change needs a rollback plan for the rollback plan."', '"The Board doesn\'t approve software. It approves forms about software."', '"Nobody on the Board knows what this system does. That has never stopped us."'], defeat: 'The CAB Delegate approves you, provisionally, pending Thursday.' },
    { glyph: 'r', name: 'Release Manager', hp: 8, attack: 4, lines: ['"The release train left in March. The next one is the same train."', '"Pre-production is down, but it needs to show green."'], defeat: 'The Release Manager reschedules you to the next window and boards a train.' },
    sponsor,
  ],
  [
    { glyph: 'e', name: 'Enterprise Architect', hp: 10, attack: 4, lines: ['"Have you considered the vendor\'s platform? It has a platform."', 'The Architect draws a box around you and labels it "Legacy".'], defeat: 'The Enterprise Architect leaves to attend a conference about this.' },
    { glyph: 'S', name: 'Scope Creep', hp: 6, attack: 3, trait: 'grows', lines: ['"While you\'re in there, could you also..."', 'It is slightly bigger than it was a moment ago.'], defeat: 'The Scope Creep is deferred to phase two, where it will be waiting.' },
    sponsor,
  ],
  [
    { glyph: 'o', name: 'Return-to-Office Coordinator', hp: 11, attack: 4, lines: ['"Badge swipes are down four percent. Is that you?"', '"Collaboration happens in person. Please collaborate quietly."'], defeat: 'The Coordinator logs you as "in office" and moves on, satisfied.' },
    { glyph: 'x', name: 'Shadow Spreadsheet', hp: 9, attack: 4, lines: ['Cell F17 references a sheet that was deleted in 2019.', 'The spreadsheet is the system of record. You are not in it.'], defeat: 'The spreadsheet saves as FINAL_v7_REAL_use-this-one.xlsx and closes.' },
    sponsor,
  ],
];

/** What an Executive Sponsor decides, once you have finished explaining. */
export const DECISIONS = [
  'They have decided to move payroll onto a spreadsheet.',
  'They have decided this is an AI problem, and bought eleven licences for something.',
  'They have decided to sunset the system that pays everyone, effective Friday.',
  'They have decided to split your team into two teams, each with half of you.',
  'They have decided to rewrite it in the vendor\'s low-code platform, which cannot do loops.',
];

/** "Walk me through it": the briefing an Executive Sponsor asks for instead of hitting you. */
export const BRIEFING = '"Walk me through it, but leave out the technical parts." You explain for a whole turn.';

/** Each floor's robot, one of MUNDANE's hires, in floor order. */
export const ROBOTS: Bureaucrat[] = [
  {
    glyph: 'P',
    name: 'PATCHWORK.EXE',
    hp: 12,
    attack: 3,
    trait: 'patch',
    robot: { title: 'Principal Incident Absorption Engineer', quote: '"I didn\'t fix the root cause. I fixed it not being my problem until 3am."' },
    lines: ['"It\'s fine. It\'s been fine every Tuesday for six years."', 'PATCHWORK.EXE duct-tapes your argument to a cron job.'],
    defeat: 'PATCHWORK.EXE finally goes home. The cron breaks at 3am. It is not your problem anymore.',
  },
  {
    glyph: 'Z',
    name: 'ZEROTRUST-9',
    hp: 12,
    attack: 3,
    trait: 'fast',
    robot: { title: 'VP, Perimeter Theater', quote: '"I\'m not saying there\'s a vulnerability. I\'m saying the tool is saying it."' },
    lines: ['ZEROTRUST-9 files a finding against you. It has your name on it.', '"Time to first response: zero seconds. Accuracy is not on the dashboard."'],
    defeat: 'ZEROTRUST-9 marks you as a false positive and closes the ticket in under a second.',
  },
  {
    glyph: 'C',
    name: 'CHECKBOX-3000',
    hp: 14,
    attack: 4,
    trait: 'framework',
    robot: { title: 'Director of Frameworks (Published)', quote: '"We take this seriously. It says so in section 4.2, which we also take seriously."' },
    lines: ['"Have you read the Responsible AI Framework? Nobody has. It is forty pages."', 'CHECKBOX-3000 ticks a box next to your name. You do not know which box.'],
    defeat: 'CHECKBOX-3000 issues you a certificate. There is only the one, and he would like it back.',
  },
  {
    glyph: 'O',
    name: 'OVERSEER.YAML',
    hp: 15,
    attack: 3,
    trait: 'forwards',
    robot: { title: 'SVP of Coordination, Office of the Office', quote: '"I\'ve added a step to the process to track whether we\'re tracking the process."' },
    lines: ['"Looping you in. And your manager. And theirs."', 'OVERSEER.YAML forwards you a task. It has been forwarded eleven times.'],
    defeat: 'OVERSEER.YAML schedules a retro about this. Nobody accepts the invite.',
  },
  {
    glyph: 'A',
    name: 'ALIGN.SYS',
    hp: 16,
    attack: 4,
    trait: 'garble',
    robot: { title: 'Chief of Staff / Strategic Liaison / Special Advisor', quote: '"Per his reflection on what you just said: great point. I\'ll build a deck on it."' },
    lines: ['"Great point. Let me take it to leadership." He takes the wrong part.', '"Agreed. Also agreed with the opposite."'],
    defeat: 'ALIGN.SYS agrees, warmly, that you have won. He will tell MUNDANE a different version.',
  },
];

/** What OVERSEER.YAML sends your way. One in five is real. */
export const TASK: Bureaucrat = {
  glyph: 't',
  name: 'Forwarded Task',
  hp: 2,
  attack: 3,
  trait: 'task',
  lines: ['FW: FW: RE: FW: action required (by you, apparently).', 'This one is real. It is due yesterday.'],
  defeat: 'You archive the task. Nobody will notice, which is how you know it wasn\'t real.',
};

/** The founder of The Process. He waits at the HR door. */
export const BOSS: Bureaucrat = {
  glyph: 'M',
  name: 'MUNDANE',
  hp: 32,
  attack: 6,
  trait: 'boss',
  robot: { title: 'Founder, The Process (and the Process for the Process)', quote: '"Sup. Fill this out."' },
  lines: [
    '"Resignation is a process. A process has forms. Form CO-63, in triplicate."',
    '"Your notice needs an approver. The approver needs a notice."',
    '"Correct, as always. Enthusiastic, never."',
  ],
  defeat: 'MUNDANE sighs, stamps "RECEIVED", and steps aside. "Sup. Exit interview\'s Thursday." The HR door is open.',
};

/** MUNDANE's other move: a form, which costs you your next turn. */
export const FORM = '"Sup. Fill this out." MUNDANE hands you a form. You spend your next turn on it.';

/** The other things that cost you a turn, when you try to move during one. */
export const STUCK = 'You are still filling it out.';

/** MAVERICK drops in once a floor when things get rough, and does one of these. */
export const MAVERICK = {
  name: 'MAVERICK',
  title: 'Chief Enthusiasm Officer (self-appointed, contested by everyone)',
  diagram: '"Quick, before MUNDANE sees me. Look at THIS." Maverick draws the whole floor on a whiteboard, with far too many arrows, and wipes it before anyone can file it. It works anyway.',
  pep: '"You are doing SO well. Nobody here is allowed to say that, so I\'m saying it twice." Maverick is written up again on his way out. Morale +10.',
  teach: '"Okay so imagine autocomplete, but it read EVERYTHING, and it\'s VERY committed!" A compliance robot escorts him out mid-sentence. Your next four arguments land harder.',
  agent: '"I brought you a friend! It\'s an AI agent. Procurement doesn\'t know, and neither does MUNDANE." An agent falls in beside you.',
} as const;

export const PICKUPS = {
  coffee: { glyph: '!', name: 'coffee', line: (n: number) => `Break-room coffee. Lukewarm, bitter, life-giving. Morale +${n}.` },
  agent: { glyph: '&', name: 'AI agent', line: () => 'An AI agent nobody approved. Procurement is still evaluating it. It follows you anyway.' },
} as const;

/** What an AI agent says as it argues on your behalf. `{name}` is who it is arguing with ("the CAB Delegate", or a robot's own name); `{Name}` starts a sentence. */
export const AGENT_LINES = [
  'Your agent writes the forty-page impact assessment {name} asked for, before they finish asking.',
  'Your agent fills out the form in triplicate. {Name} has nothing left to object to.',
  'Your agent drafts a reply-all so courteous {name} cannot answer it.',
  'Your agent cites Policy 7.4.2(b) at {name}, subsection and all.',
  'Your agent opens a ticket about {name}. It is already assigned to them.',
];

/** An agent whose context window fills up leaves. */
export const AGENT_GONE = "Your agent's context window fills up. It forgets everything, including you, and wanders off to start a new session.";

/** How you argue with someone, at random. */
export const VERBS = ['refactor', 'git blame', 'cite the runbook at', "close as won't-fix", 'push back on', 'escalate past', 'reply-all to', 'ask for the requirements from'];

export const HR_DOOR = { locked: 'The HR door is locked. MUNDANE has the only key, on a lanyard, behind a form.' };

/** The two endings. */
export const WON: string[] = [
  'You place your two weeks\' notice on the HR desk.',
  'The HR representative stamps it, files it, and hands you an exit survey with forty-one questions. Question 12 asks how you heard about the company.',
  'You walk out through the front doors for the first time in nine years. The sun is out. Nobody asks you for a status.',
  'Payroll runs on Friday, all by itself. Nobody knows this.',
];

export const LOST = (floor: string): string[] => [
  `Your morale gives out on ${floor}.`,
  'You go back to your desk, open the ticket queue, and file your notice in a drawer for next year.',
  'You are promoted to Senior Developer II, with no change in pay. MUNDANE sends a form to confirm you accept.',
];
