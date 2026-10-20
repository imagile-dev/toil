/**
 * A GitHub repository run without a Projects board, as GitHub's REST API
 * returned it: twelve of the issues `github list-issues --state all` read
 * from a seeded private repository on 2026-10-19 (ui/scripts/seed-sandbox.mjs
 * made it), and five of their timelines (`github issue-events`). Milestones
 * Sprint 41 (closed), 42 and 43 as sprints, `points: N` labels, and
 * "Blocked by #n" in the bodies. Sanitized to placeholders (the repository is
 * imagile/payments-sandbox and every login octo-dev) and trimmed to the fields
 * the mapper reads and their neighbours. test/owi.test.ts maps it. The
 * evidence pack, as captured, with the names changed to protect the sprint.
 */

export const boardlessIssues: Array<Record<string, unknown>> = [
  {
    "url": "https://api.github.com/repos/imagile/payments-sandbox/issues/23",
    "repository_url": "https://api.github.com/repos/imagile/payments-sandbox",
    "html_url": "https://github.com/imagile/payments-sandbox/issues/23",
    "number": 23,
    "title": "Support Apple Pay on the hosted checkout page",
    "user": {
      "login": "octo-dev",
      "type": "User"
    },
    "labels": [
      {
        "name": "type: feature",
        "color": "a2eeef",
        "description": "New behavior"
      },
      {
        "name": "priority: medium",
        "color": "fbca04",
        "description": "Do this soon"
      }
    ],
    "state": "open",
    "assignees": [],
    "assignee": null,
    "milestone": null,
    "comments": 0,
    "created_at": "2026-10-19T22:02:57Z",
    "updated_at": "2026-10-19T22:02:57Z",
    "closed_at": null,
    "type": null,
    "sub_issues_summary": {
      "total": 0,
      "completed": 0,
      "percent_completed": 0
    },
    "issue_dependencies_summary": {
      "blocked_by": 0,
      "total_blocked_by": 0,
      "blocking": 0,
      "total_blocking": 0
    },
    "body": "Merchants have asked for this. Not estimated: needs a spike on domain verification.\n\nStale on purpose: this is test data, and GitHub can't backdate an issue, so read it as one nobody has touched in weeks.",
    "state_reason": null
  },
  {
    "url": "https://api.github.com/repos/imagile/payments-sandbox/issues/20",
    "repository_url": "https://api.github.com/repos/imagile/payments-sandbox",
    "html_url": "https://github.com/imagile/payments-sandbox/issues/20",
    "number": 20,
    "title": "Send merchants a webhook when a dispute is opened",
    "user": {
      "login": "octo-dev",
      "type": "User"
    },
    "labels": [
      {
        "name": "type: feature",
        "color": "a2eeef",
        "description": "New behavior"
      },
      {
        "name": "priority: high",
        "color": "b60205",
        "description": "Do this first"
      },
      {
        "name": "points: 3",
        "color": "c5def5",
        "description": "Estimate"
      },
      {
        "name": "blocked",
        "color": "000000",
        "description": "Waiting on another issue"
      }
    ],
    "state": "open",
    "assignees": [],
    "assignee": null,
    "milestone": {
      "url": "https://api.github.com/repos/imagile/payments-sandbox/milestones/3",
      "html_url": "https://github.com/imagile/payments-sandbox/milestone/3",
      "number": 3,
      "title": "Sprint 43",
      "description": "The next sprint.",
      "open_issues": 6,
      "closed_issues": 0,
      "state": "open",
      "created_at": "2026-10-19T22:02:18Z",
      "updated_at": "2026-10-19T22:02:56Z",
      "due_on": "2026-11-09T00:00:00Z",
      "closed_at": null
    },
    "comments": 0,
    "created_at": "2026-10-19T22:02:53Z",
    "updated_at": "2026-10-19T22:03:05Z",
    "closed_at": null,
    "type": null,
    "sub_issues_summary": {
      "total": 0,
      "completed": 0,
      "percent_completed": 0
    },
    "issue_dependencies_summary": {
      "blocked_by": 0,
      "total_blocked_by": 0,
      "blocking": 0,
      "total_blocking": 0
    },
    "body": "Merchants learn about disputes from the dashboard today. A webhook lets them respond before the evidence deadline.\n\nBlocked by #1.",
    "state_reason": null
  },
  {
    "url": "https://api.github.com/repos/imagile/payments-sandbox/issues/18",
    "repository_url": "https://api.github.com/repos/imagile/payments-sandbox",
    "html_url": "https://github.com/imagile/payments-sandbox/issues/18",
    "number": 18,
    "title": "Rolling reserve for high-risk merchants",
    "user": {
      "login": "octo-dev",
      "type": "User"
    },
    "labels": [
      {
        "name": "type: feature",
        "color": "a2eeef",
        "description": "New behavior"
      },
      {
        "name": "priority: medium",
        "color": "fbca04",
        "description": "Do this soon"
      },
      {
        "name": "points: 8",
        "color": "c5def5",
        "description": "Estimate"
      },
      {
        "name": "blocked",
        "color": "000000",
        "description": "Waiting on another issue"
      }
    ],
    "state": "open",
    "assignees": [],
    "assignee": null,
    "milestone": {
      "url": "https://api.github.com/repos/imagile/payments-sandbox/milestones/3",
      "html_url": "https://github.com/imagile/payments-sandbox/milestone/3",
      "number": 3,
      "title": "Sprint 43",
      "description": "The next sprint.",
      "open_issues": 6,
      "closed_issues": 0,
      "state": "open",
      "created_at": "2026-10-19T22:02:18Z",
      "updated_at": "2026-10-19T22:02:56Z",
      "due_on": "2026-11-09T00:00:00Z",
      "closed_at": null
    },
    "comments": 0,
    "created_at": "2026-10-19T22:02:51Z",
    "updated_at": "2026-10-19T22:03:03Z",
    "closed_at": null,
    "type": null,
    "sub_issues_summary": {
      "total": 0,
      "completed": 0,
      "percent_completed": 0
    },
    "issue_dependencies_summary": {
      "blocked_by": 0,
      "total_blocked_by": 0,
      "blocking": 0,
      "total_blocking": 0
    },
    "body": "Hold back a configurable percentage of each payout for 90 days for merchants flagged high risk.\n\nBlocked by #17.",
    "state_reason": null
  },
  {
    "url": "https://api.github.com/repos/imagile/payments-sandbox/issues/17",
    "repository_url": "https://api.github.com/repos/imagile/payments-sandbox",
    "html_url": "https://github.com/imagile/payments-sandbox/issues/17",
    "number": 17,
    "title": "Payout preview: show merchants what the next payout will contain",
    "user": {
      "login": "octo-dev",
      "type": "User"
    },
    "labels": [
      {
        "name": "type: feature",
        "color": "a2eeef",
        "description": "New behavior"
      },
      {
        "name": "priority: medium",
        "color": "fbca04",
        "description": "Do this soon"
      },
      {
        "name": "points: 5",
        "color": "c5def5",
        "description": "Estimate"
      }
    ],
    "state": "open",
    "assignees": [],
    "assignee": null,
    "milestone": {
      "url": "https://api.github.com/repos/imagile/payments-sandbox/milestones/3",
      "html_url": "https://github.com/imagile/payments-sandbox/milestone/3",
      "number": 3,
      "title": "Sprint 43",
      "description": "The next sprint.",
      "open_issues": 6,
      "closed_issues": 0,
      "state": "open",
      "created_at": "2026-10-19T22:02:18Z",
      "updated_at": "2026-10-19T22:02:56Z",
      "due_on": "2026-11-09T00:00:00Z",
      "closed_at": null
    },
    "comments": 0,
    "created_at": "2026-10-19T22:02:50Z",
    "updated_at": "2026-10-19T22:02:50Z",
    "closed_at": null,
    "type": null,
    "sub_issues_summary": {
      "total": 0,
      "completed": 0,
      "percent_completed": 0
    },
    "issue_dependencies_summary": {
      "blocked_by": 0,
      "total_blocked_by": 0,
      "blocking": 0,
      "total_blocking": 0
    },
    "body": "A read-only view of the pending balance, holds and the expected payout date.",
    "state_reason": null
  },
  {
    "url": "https://api.github.com/repos/imagile/payments-sandbox/issues/15",
    "repository_url": "https://api.github.com/repos/imagile/payments-sandbox",
    "html_url": "https://github.com/imagile/payments-sandbox/issues/15",
    "number": 15,
    "title": "When a merchant changes their payout schedule from daily to weekly in the middle of a settlement cycle, the pending balance is split across two payouts and the second one is labelled with the wrong period on the statement",
    "user": {
      "login": "octo-dev",
      "type": "User"
    },
    "labels": [
      {
        "name": "type: bug",
        "color": "d73a4a",
        "description": "Something is broken"
      },
      {
        "name": "priority: medium",
        "color": "fbca04",
        "description": "Do this soon"
      }
    ],
    "state": "open",
    "assignees": [
      {
        "login": "octo-dev",
        "type": "User"
      }
    ],
    "assignee": {
      "login": "octo-dev",
      "type": "User"
    },
    "milestone": {
      "url": "https://api.github.com/repos/imagile/payments-sandbox/milestones/2",
      "html_url": "https://github.com/imagile/payments-sandbox/milestone/2",
      "number": 2,
      "title": "Sprint 42",
      "description": "The current sprint: two weeks ending next week.",
      "open_issues": 8,
      "closed_issues": 2,
      "state": "open",
      "created_at": "2026-10-19T22:02:17Z",
      "updated_at": "2026-10-19T22:03:15Z",
      "due_on": "2026-10-26T00:00:00Z",
      "closed_at": null
    },
    "comments": 0,
    "created_at": "2026-10-19T22:02:47Z",
    "updated_at": "2026-10-19T22:02:47Z",
    "closed_at": null,
    "type": null,
    "sub_issues_summary": {
      "total": 0,
      "completed": 0,
      "percent_completed": 0
    },
    "issue_dependencies_summary": {
      "blocked_by": 0,
      "total_blocked_by": 0,
      "blocking": 0,
      "total_blocking": 0
    },
    "body": "Not estimated yet: needs a look at how the payout scheduler closes a period early.",
    "state_reason": null
  },
  {
    "url": "https://api.github.com/repos/imagile/payments-sandbox/issues/13",
    "repository_url": "https://api.github.com/repos/imagile/payments-sandbox",
    "html_url": "https://github.com/imagile/payments-sandbox/issues/13",
    "number": 13,
    "title": "Monthly statement CSV is missing the fee column for partial refunds",
    "user": {
      "login": "octo-dev",
      "type": "User"
    },
    "labels": [
      {
        "name": "type: bug",
        "color": "d73a4a",
        "description": "Something is broken"
      },
      {
        "name": "priority: medium",
        "color": "fbca04",
        "description": "Do this soon"
      },
      {
        "name": "points: 2",
        "color": "c5def5",
        "description": "Estimate"
      }
    ],
    "state": "closed",
    "assignees": [],
    "assignee": null,
    "milestone": {
      "url": "https://api.github.com/repos/imagile/payments-sandbox/milestones/2",
      "html_url": "https://github.com/imagile/payments-sandbox/milestone/2",
      "number": 2,
      "title": "Sprint 42",
      "description": "The current sprint: two weeks ending next week.",
      "open_issues": 8,
      "closed_issues": 2,
      "state": "open",
      "created_at": "2026-10-19T22:02:17Z",
      "updated_at": "2026-10-19T22:03:15Z",
      "due_on": "2026-10-26T00:00:00Z",
      "closed_at": null
    },
    "comments": 0,
    "created_at": "2026-10-19T22:02:43Z",
    "updated_at": "2026-10-19T22:02:44Z",
    "closed_at": "2026-10-19T22:02:44Z",
    "type": null,
    "sub_issues_summary": {
      "total": 0,
      "completed": 0,
      "percent_completed": 0
    },
    "issue_dependencies_summary": {
      "blocked_by": 0,
      "total_blocked_by": 0,
      "blocking": 0,
      "total_blocking": 0
    },
    "body": "Partial refunds leave the fee column empty in the monthly CSV.",
    "state_reason": "completed"
  },
  {
    "url": "https://api.github.com/repos/imagile/payments-sandbox/issues/12",
    "repository_url": "https://api.github.com/repos/imagile/payments-sandbox",
    "html_url": "https://github.com/imagile/payments-sandbox/issues/12",
    "number": 12,
    "title": "Keep idempotency keys for 24 hours in a shared store instead of per instance",
    "user": {
      "login": "octo-dev",
      "type": "User"
    },
    "labels": [
      {
        "name": "type: feature",
        "color": "a2eeef",
        "description": "New behavior"
      },
      {
        "name": "priority: high",
        "color": "b60205",
        "description": "Do this first"
      },
      {
        "name": "points: 5",
        "color": "c5def5",
        "description": "Estimate"
      },
      {
        "name": "blocked",
        "color": "000000",
        "description": "Waiting on another issue"
      }
    ],
    "state": "open",
    "assignees": [],
    "assignee": null,
    "milestone": {
      "url": "https://api.github.com/repos/imagile/payments-sandbox/milestones/2",
      "html_url": "https://github.com/imagile/payments-sandbox/milestone/2",
      "number": 2,
      "title": "Sprint 42",
      "description": "The current sprint: two weeks ending next week.",
      "open_issues": 8,
      "closed_issues": 2,
      "state": "open",
      "created_at": "2026-10-19T22:02:17Z",
      "updated_at": "2026-10-19T22:03:15Z",
      "due_on": "2026-10-26T00:00:00Z",
      "closed_at": null
    },
    "comments": 0,
    "created_at": "2026-10-19T22:02:42Z",
    "updated_at": "2026-10-19T22:03:01Z",
    "closed_at": null,
    "type": null,
    "sub_issues_summary": {
      "total": 0,
      "completed": 0,
      "percent_completed": 0
    },
    "issue_dependencies_summary": {
      "blocked_by": 0,
      "total_blocked_by": 0,
      "blocking": 0,
      "total_blocking": 0
    },
    "body": "Idempotency keys live in each instance's memory, so a retry that lands on another instance is not recognised.\n\nBlocked by #11.",
    "state_reason": null
  },
  {
    "url": "https://api.github.com/repos/imagile/payments-sandbox/issues/11",
    "repository_url": "https://api.github.com/repos/imagile/payments-sandbox",
    "html_url": "https://github.com/imagile/payments-sandbox/issues/11",
    "number": 11,
    "title": "Duplicate capture when the client retries a timed-out request",
    "user": {
      "login": "octo-dev",
      "type": "User"
    },
    "labels": [
      {
        "name": "type: bug",
        "color": "d73a4a",
        "description": "Something is broken"
      },
      {
        "name": "priority: high",
        "color": "b60205",
        "description": "Do this first"
      },
      {
        "name": "points: 3",
        "color": "c5def5",
        "description": "Estimate"
      }
    ],
    "state": "open",
    "assignees": [
      {
        "login": "octo-dev",
        "type": "User"
      }
    ],
    "assignee": {
      "login": "octo-dev",
      "type": "User"
    },
    "milestone": {
      "url": "https://api.github.com/repos/imagile/payments-sandbox/milestones/2",
      "html_url": "https://github.com/imagile/payments-sandbox/milestone/2",
      "number": 2,
      "title": "Sprint 42",
      "description": "The current sprint: two weeks ending next week.",
      "open_issues": 8,
      "closed_issues": 2,
      "state": "open",
      "created_at": "2026-10-19T22:02:17Z",
      "updated_at": "2026-10-19T22:03:15Z",
      "due_on": "2026-10-26T00:00:00Z",
      "closed_at": null
    },
    "comments": 0,
    "created_at": "2026-10-19T22:02:41Z",
    "updated_at": "2026-10-19T22:02:41Z",
    "closed_at": null,
    "type": null,
    "sub_issues_summary": {
      "total": 0,
      "completed": 0,
      "percent_completed": 0
    },
    "issue_dependencies_summary": {
      "blocked_by": 0,
      "total_blocked_by": 0,
      "blocking": 0,
      "total_blocking": 0
    },
    "body": "A capture that times out at the client and is retried with the same idempotency key is captured twice about once a day.",
    "state_reason": null
  },
  {
    "url": "https://api.github.com/repos/imagile/payments-sandbox/issues/8",
    "repository_url": "https://api.github.com/repos/imagile/payments-sandbox",
    "html_url": "https://github.com/imagile/payments-sandbox/issues/8",
    "number": 8,
    "title": "Rotate the card vault encryption keys without downtime",
    "user": {
      "login": "octo-dev",
      "type": "User"
    },
    "labels": [
      {
        "name": "type: feature",
        "color": "a2eeef",
        "description": "New behavior"
      },
      {
        "name": "priority: high",
        "color": "b60205",
        "description": "Do this first"
      },
      {
        "name": "points: 5",
        "color": "c5def5",
        "description": "Estimate"
      },
      {
        "name": "blocked",
        "color": "000000",
        "description": "Waiting on another issue"
      }
    ],
    "state": "open",
    "assignees": [
      {
        "login": "octo-dev",
        "type": "User"
      }
    ],
    "assignee": {
      "login": "octo-dev",
      "type": "User"
    },
    "milestone": {
      "url": "https://api.github.com/repos/imagile/payments-sandbox/milestones/2",
      "html_url": "https://github.com/imagile/payments-sandbox/milestone/2",
      "number": 2,
      "title": "Sprint 42",
      "description": "The current sprint: two weeks ending next week.",
      "open_issues": 8,
      "closed_issues": 2,
      "state": "open",
      "created_at": "2026-10-19T22:02:17Z",
      "updated_at": "2026-10-19T22:03:15Z",
      "due_on": "2026-10-26T00:00:00Z",
      "closed_at": null
    },
    "comments": 0,
    "created_at": "2026-10-19T22:02:37Z",
    "updated_at": "2026-10-19T22:03:00Z",
    "closed_at": null,
    "type": null,
    "sub_issues_summary": {
      "total": 0,
      "completed": 0,
      "percent_completed": 0
    },
    "issue_dependencies_summary": {
      "blocked_by": 0,
      "total_blocked_by": 0,
      "blocking": 0,
      "total_blocking": 0
    },
    "body": "Re-encrypt vault entries under a new key in the background while both keys decrypt.\n\nBlocked by #7.",
    "state_reason": null
  },
  {
    "url": "https://api.github.com/repos/imagile/payments-sandbox/issues/7",
    "repository_url": "https://api.github.com/repos/imagile/payments-sandbox",
    "html_url": "https://github.com/imagile/payments-sandbox/issues/7",
    "number": 7,
    "title": "Tokenise stored cards at the edge so the core service never sees a PAN",
    "user": {
      "login": "octo-dev",
      "type": "User"
    },
    "labels": [
      {
        "name": "type: feature",
        "color": "a2eeef",
        "description": "New behavior"
      },
      {
        "name": "priority: high",
        "color": "b60205",
        "description": "Do this first"
      },
      {
        "name": "points: 8",
        "color": "c5def5",
        "description": "Estimate"
      }
    ],
    "state": "open",
    "assignees": [
      {
        "login": "octo-dev",
        "type": "User"
      }
    ],
    "assignee": {
      "login": "octo-dev",
      "type": "User"
    },
    "milestone": {
      "url": "https://api.github.com/repos/imagile/payments-sandbox/milestones/2",
      "html_url": "https://github.com/imagile/payments-sandbox/milestone/2",
      "number": 2,
      "title": "Sprint 42",
      "description": "The current sprint: two weeks ending next week.",
      "open_issues": 8,
      "closed_issues": 2,
      "state": "open",
      "created_at": "2026-10-19T22:02:17Z",
      "updated_at": "2026-10-19T22:03:15Z",
      "due_on": "2026-10-26T00:00:00Z",
      "closed_at": null
    },
    "comments": 0,
    "created_at": "2026-10-19T22:02:35Z",
    "updated_at": "2026-10-19T22:02:36Z",
    "closed_at": null,
    "type": null,
    "sub_issues_summary": {
      "total": 0,
      "completed": 0,
      "percent_completed": 0
    },
    "issue_dependencies_summary": {
      "blocked_by": 0,
      "total_blocked_by": 0,
      "blocking": 0,
      "total_blocking": 0
    },
    "body": "Card numbers are replaced by a token at the edge proxy. The core payments service stores and forwards only tokens.",
    "state_reason": null
  },
  {
    "url": "https://api.github.com/repos/imagile/payments-sandbox/issues/5",
    "repository_url": "https://api.github.com/repos/imagile/payments-sandbox",
    "html_url": "https://github.com/imagile/payments-sandbox/issues/5",
    "number": 5,
    "title": "Exponential backoff for failed payout retries",
    "user": {
      "login": "octo-dev",
      "type": "User"
    },
    "labels": [
      {
        "name": "type: feature",
        "color": "a2eeef",
        "description": "New behavior"
      },
      {
        "name": "priority: medium",
        "color": "fbca04",
        "description": "Do this soon"
      },
      {
        "name": "points: 3",
        "color": "c5def5",
        "description": "Estimate"
      }
    ],
    "state": "open",
    "assignees": [
      {
        "login": "octo-dev",
        "type": "User"
      }
    ],
    "assignee": {
      "login": "octo-dev",
      "type": "User"
    },
    "milestone": {
      "url": "https://api.github.com/repos/imagile/payments-sandbox/milestones/1",
      "html_url": "https://github.com/imagile/payments-sandbox/milestone/1",
      "number": 1,
      "title": "Sprint 41",
      "description": "Two weeks ending last week.",
      "open_issues": 1,
      "closed_issues": 5,
      "state": "closed",
      "created_at": "2026-10-19T22:02:17Z",
      "updated_at": "2026-10-19T22:02:34Z",
      "due_on": "2026-10-12T00:00:00Z",
      "closed_at": "2026-10-19T22:02:17Z"
    },
    "comments": 0,
    "created_at": "2026-10-19T22:02:31Z",
    "updated_at": "2026-10-19T22:02:31Z",
    "closed_at": null,
    "type": null,
    "sub_issues_summary": {
      "total": 0,
      "completed": 0,
      "percent_completed": 0
    },
    "issue_dependencies_summary": {
      "blocked_by": 0,
      "total_blocked_by": 0,
      "blocking": 0,
      "total_blocking": 0
    },
    "body": "Payout retries currently fire every 60 seconds. Back off exponentially up to an hour, with jitter, and stop after 8 attempts. Carried over from Sprint 41.",
    "state_reason": null
  },
  {
    "url": "https://api.github.com/repos/imagile/payments-sandbox/issues/1",
    "repository_url": "https://api.github.com/repos/imagile/payments-sandbox",
    "html_url": "https://github.com/imagile/payments-sandbox/issues/1",
    "number": 1,
    "title": "Verify webhook signatures from the card processor",
    "user": {
      "login": "octo-dev",
      "type": "User"
    },
    "labels": [
      {
        "name": "type: feature",
        "color": "a2eeef",
        "description": "New behavior"
      },
      {
        "name": "priority: high",
        "color": "b60205",
        "description": "Do this first"
      },
      {
        "name": "points: 5",
        "color": "c5def5",
        "description": "Estimate"
      }
    ],
    "state": "closed",
    "assignees": [
      {
        "login": "octo-dev",
        "type": "User"
      }
    ],
    "assignee": {
      "login": "octo-dev",
      "type": "User"
    },
    "milestone": {
      "url": "https://api.github.com/repos/imagile/payments-sandbox/milestones/1",
      "html_url": "https://github.com/imagile/payments-sandbox/milestone/1",
      "number": 1,
      "title": "Sprint 41",
      "description": "Two weeks ending last week.",
      "open_issues": 1,
      "closed_issues": 5,
      "state": "closed",
      "created_at": "2026-10-19T22:02:17Z",
      "updated_at": "2026-10-19T22:02:34Z",
      "due_on": "2026-10-12T00:00:00Z",
      "closed_at": "2026-10-19T22:02:17Z"
    },
    "comments": 0,
    "created_at": "2026-10-19T22:02:19Z",
    "updated_at": "2026-10-19T22:02:21Z",
    "closed_at": "2026-10-19T22:02:21Z",
    "type": null,
    "sub_issues_summary": {
      "total": 0,
      "completed": 0,
      "percent_completed": 0
    },
    "issue_dependencies_summary": {
      "blocked_by": 0,
      "total_blocked_by": 0,
      "blocking": 0,
      "total_blocking": 0
    },
    "body": "Reject any processor webhook whose HMAC signature does not match the shared secret, and log the rejection with the event id.",
    "state_reason": "completed"
  }
];

/** Timelines by issue number. */
export const boardlessTimelines: Record<number, Array<Record<string, unknown>>> = {
  "5": [
    {
      "event": "milestoned",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:31Z",
      "milestone": {
        "title": "Sprint 41"
      }
    },
    {
      "event": "assigned",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:31Z",
      "assignee": {
        "login": "octo-dev",
        "type": "User"
      }
    },
    {
      "event": "labeled",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:33Z",
      "label": {
        "name": "type: feature"
      }
    },
    {
      "event": "labeled",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:33Z",
      "label": {
        "name": "priority: medium"
      }
    },
    {
      "event": "labeled",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:33Z",
      "label": {
        "name": "points: 3"
      }
    },
    {
      "event": "cross-referenced",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:03:31Z",
      "source": {
        "type": "issue",
        "issue": {
          "number": 29,
          "html_url": "https://github.com/imagile/payments-sandbox/pull/29"
        }
      }
    }
  ],
  "7": [
    {
      "event": "milestoned",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:36Z",
      "milestone": {
        "title": "Sprint 42"
      }
    },
    {
      "event": "assigned",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:36Z",
      "assignee": {
        "login": "octo-dev",
        "type": "User"
      }
    },
    {
      "event": "labeled",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:38Z",
      "label": {
        "name": "type: feature"
      }
    },
    {
      "event": "labeled",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:38Z",
      "label": {
        "name": "priority: high"
      }
    },
    {
      "event": "labeled",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:38Z",
      "label": {
        "name": "points: 8"
      }
    },
    {
      "event": "cross-referenced",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:03:01Z",
      "source": {
        "type": "issue",
        "issue": {
          "number": 8,
          "html_url": "https://github.com/imagile/payments-sandbox/issues/8"
        }
      }
    }
  ],
  "8": [
    {
      "event": "milestoned",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:37Z",
      "milestone": {
        "title": "Sprint 42"
      }
    },
    {
      "event": "assigned",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:37Z",
      "assignee": {
        "login": "octo-dev",
        "type": "User"
      }
    },
    {
      "event": "labeled",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:39Z",
      "label": {
        "name": "type: feature"
      }
    },
    {
      "event": "labeled",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:39Z",
      "label": {
        "name": "priority: high"
      }
    },
    {
      "event": "labeled",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:39Z",
      "label": {
        "name": "points: 5"
      }
    },
    {
      "event": "labeled",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:39Z",
      "label": {
        "name": "blocked"
      }
    }
  ],
  "11": [
    {
      "event": "milestoned",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:41Z",
      "milestone": {
        "title": "Sprint 42"
      }
    },
    {
      "event": "assigned",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:41Z",
      "assignee": {
        "login": "octo-dev",
        "type": "User"
      }
    },
    {
      "event": "labeled",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:43Z",
      "label": {
        "name": "type: bug"
      }
    },
    {
      "event": "labeled",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:43Z",
      "label": {
        "name": "priority: high"
      }
    },
    {
      "event": "labeled",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:43Z",
      "label": {
        "name": "points: 3"
      }
    },
    {
      "event": "cross-referenced",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:03:02Z",
      "source": {
        "type": "issue",
        "issue": {
          "number": 12,
          "html_url": "https://github.com/imagile/payments-sandbox/issues/12"
        }
      }
    }
  ],
  "12": [
    {
      "event": "milestoned",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:42Z",
      "milestone": {
        "title": "Sprint 42"
      }
    },
    {
      "event": "labeled",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:43Z",
      "label": {
        "name": "type: feature"
      }
    },
    {
      "event": "labeled",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:44Z",
      "label": {
        "name": "priority: high"
      }
    },
    {
      "event": "labeled",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:44Z",
      "label": {
        "name": "points: 5"
      }
    },
    {
      "event": "labeled",
      "actor": {
        "login": "octo-dev",
        "type": "User"
      },
      "created_at": "2026-10-19T22:02:44Z",
      "label": {
        "name": "blocked"
      }
    }
  ]
};
