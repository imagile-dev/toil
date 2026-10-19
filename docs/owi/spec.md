# Open Work Item (OWI), version 0.1

OWI is one model for a work item from any issue tracker toil reads: Jira Data
Center and Jira Cloud, Azure DevOps and GitHub. It exists so a board, a sprint
report or an agent can read three trackers as one without learning each one's
fields. No adoptable standard covers it: OSLC Change Management is RDF-first and
no tracker serves it, and the unified-API vendors' ticket models are proprietary
and have no sprints, estimates or history (#206, **Prior art**). OWI publishes a
mapping to OSLC CM instead (below), so it can be exported there if that is ever
needed.

- **Schema:** [`schema.json`](schema.json), JSON Schema 2020-12. Every item toil
  maps is validated against it before it is returned.
- **Mappers:** `src/core/owi/`, one per source shape, used by `toil util owi map`
  (`skills/toil/util.md`) and by `mapOwi` in `@imagile-dev/toil/api`.
- **Versioning:** every record says its version in `owi`. Changes are additive
  only, as in the command contract: a new field, a new enum value, a new source.
  Removing or repurposing a field is a new major version.
- **Honesty:** a field the record didn't hold is listed in the item's `unmapped`
  with the reason, never guessed (principle 4). `native` keeps the source records
  untouched, so every mapped value can be traced back.

## The work item

| Field | Type | Meaning |
|-------|------|---------|
| `owi` | `"0.1"` | The OWI version of this record |
| `id` | string | `<connection>:<native key>`: the toil connection, then the source's key. `corp-jira:PAY-101`, `corp-ado:2302`, `github:imagile/payments-web#41` |
| `source` | object | `{ area, connection, key, command }`: the toil area, the connection, the native key, and the command whose output was mapped |
| `url` | string or null | The item in the source's web UI |
| `type` | enum | `EPIC`, `STORY`, `TASK`, `BUG`, `INCIDENT` or `OTHER` |
| `typeName` | string or null | The source's own word for the type (Product Backlog Item, Sub-task, Feature). Show it beside `type` |
| `title` | string | The summary or title |
| `body` | object or null | `{ format, content }`: `markdown` (GitHub), `wiki` (Jira Data Center), `adf` (Jira Cloud, an object) or `html` (Azure DevOps). `toil util md` converts wiki and ADF to Markdown |
| `status` | string or null | The source's own status name |
| `statusCategory` | enum | `TODO`, `IN_PROGRESS`, `DONE` or `UNKNOWN` (below) |
| `resolution` | string or null | How a finished item finished, in the source's words: Jira's resolution, GitHub's `state_reason`, Azure DevOps' reason |
| `assignee` | Person or null | `{ id, name, email }`. GitHub's first assignee; the rest are in `native` |
| `reporter` | Person or null | Who created it |
| `priority` | string or null | The priority's name, as text |
| `estimate` | object or null | `{ value, unit, field }`: `unit` is `points`, `hours` or `days`, and `field` the source field it came from |
| `labels` | string[] | Labels, or Azure DevOps tags |
| `team` | string or null | Only from an override (`fields team`): no source has a default team field |
| `iteration` | Iteration or null | `{ id, name, path, start, end, state }`: the sprint the item is in now. `state` is Jira's sprint state as `past`, `current` or `future`, else null |
| `parent` | id or null | The parent item's OWI id |
| `children` | id[] | Sub-tasks, child work items, sub-issues |
| `links` | Link[] | `{ type, direction, target, name }`: `type` is `blocks`, `relates`, `duplicates`, `implements` or `other`; `outward` means this item `<type>` the target (it blocks it), `inward` the target `<type>` this item; `name` is the source's wording |
| `created` | instant or null | UTC, as `toISOString` writes it |
| `updated` | instant or null | |
| `resolved` | instant or null | When it was resolved or closed |
| `dueDate` | date or null | `YYYY-MM-DD` |
| `history` | object or null | `{ transitions, iterations }`, from the history commands. Null when no history was mapped, which is not the same as an empty one |
| `unmapped` | object[] | `{ field, reason }` for each field the record couldn't fill |
| `native` | object | The source records, keyed by the command that returned each |

**History.** A transition is `{ from, to, fromCategory, toCategory, at, by }`,
the first one recorded having `from: null`; cycle time is the time between
transitions. An iteration change is `{ from, to, at, by }`, each side a list of
iteration names: an item moving into the sprint after it started is scope added,
and one whose `from` names the previous sprint was carried over.

**Status categories.** Taken from the source where it has them, else from the
documented defaults below. A status with neither is `UNKNOWN`, with an
`OWI_UNKNOWN_STATE` warning naming it and an `unmapped` entry; never guessed.

## Mapping each source

The commands whose output maps, and what each gives:

| Area | Items | History | Context |
|------|-------|---------|---------|
| `jira`, `jira-cloud` | `jira search`, `jira get-issue`, `jira-cloud search`, `jira-cloud get-issue` | `jira get-changelog`, `jira-cloud get-changelog` | |
| `ado`, `ado-cloud` | `ado work get`, `ado work get-batch`, `ado-cloud work get`, `ado-cloud work get-batch` | `ado work revisions`, `ado-cloud work revisions` | `ado work list-iterations`, `ado-cloud work list-iterations` (iteration dates) |
| `github` | `github list-issues`, `github search-issues`, `github get-issue`, `github projects list-items` | `github issue-events` | |

`ado work search` and `ado-cloud work search` return ids only, so they are skipped
with a pointer to `work get-batch`. Pull requests (in GitHub's issue lists and on boards) are
left out, with a warning: they are the changes that reference work, which a later
version will carry. Any other command's output is refused.

### Jira (Data Center and Cloud)

- **Type** from the issue type; a sub-task is `TASK`. **Status category** from
  `status.statusCategory.key`: `new` is `TODO`, `indeterminate` `IN_PROGRESS`,
  `done` `DONE`. A changelog names statuses only, so its transitions take their
  categories from the items in the same input.
- **Estimate**, points: the field named **Story Points** (Data Center and
  company-managed Cloud), then **Story point estimate** (team-managed Cloud).
  Both are custom fields whose id differs per site, so they are found by the name
  the connection registers them under (`customFields`), or by an expanded `names`
  map; never by a hard-coded `customfield_` id. Then hours: `timeoriginalestimate`,
  which Jira stores in seconds.
- **Iteration** from the **Sprint** field: Cloud's sprint objects, or Data
  Center's `com.atlassian.greenhopper.service.sprint.Sprint@…[id=…,state=…]`
  strings. The active sprint, else the latest future one, else the last.
- **Parent** from `parent`, else Data Center's **Epic Link**; children from
  `subtasks`; links from `issuelinks` by link type (Blocks, Duplicate, Relates).
- `search` returns the fields it asks for (`--fields`), and only the custom fields
  the connection registers; `get-issue` returns every field. A field missing from
  the record is listed in `unmapped`.

### Azure DevOps (Server and Services)

`ado` (Azure DevOps Server) and `ado-cloud` (Azure DevOps Services) send the same
work item, revision and classification-node shapes, so one mapper reads both. Where
Services differs, the mapping already holds:

- **People**: on Services an identity's `uniqueName` is the sign-in email, so
  `email` is set; on Server it is often `DOMAIN\user`, which has no `@`, so `email`
  is null and `id` is that name.
- **URL**: a Services work item's API `url` is under the organization
  (`https://dev.azure.com/<org>/_apis/...`), with no collection segment, and the web
  link is built from it the same way: `https://dev.azure.com/<org>/<project>/_workitems/edit/<id>`.
- **Ids** are `<connection>:<id>` for both, so the two areas' items never collide.

- **Type** from `System.WorkItemType`: User Story, Product Backlog Item and
  Requirement are `STORY`, and so is Basic's Issue; Feature is `OTHER`.
- **Status category** by the default states' categories ([Microsoft's
  table](https://learn.microsoft.com/en-us/azure/devops/boards/work-items/workflow-and-state-categories)):
  New, To Do, Approved and Proposed are `TODO`; Active, Doing, Committed, Open and
  Resolved are `IN_PROGRESS` (Resolved behaves as in progress on boards); Closed
  and Done are `DONE`; Removed is `DONE` with its reason as `resolution`. A custom
  state is `UNKNOWN`; `ado work list-states` shows its category.
- **Estimate**, the first with a value: `Microsoft.VSTS.Scheduling.StoryPoints`
  (Agile), `.Effort` (Scrum), `.Size` (CMMI) as points, then
  `Microsoft.VSTS.Scheduling.OriginalEstimate` as hours. Azure DevOps leaves an
  empty field out of the record, so an unestimated item and one estimated in a
  team's own field look alike; both are listed in `unmapped`.
- **Iteration** from `System.IterationPath`, with dates when the input also holds
  `ado work list-iterations`. **Parent** and **children** from the hierarchy
  relations; **links** from the dependency links, Successor and its reverse (`blocks`), Related,
  Duplicate and Duplicate Of. History from `ado work revisions`: each change of
  `System.State` and `System.IterationPath`.

### GitHub

- **Type** from the issue type (GitHub's defaults are Task, Bug and Feature).
  **Parent** from `parent_issue_url`, **children** from `sub_issues`
  (`get-issue --sub-issues`).
- **Status, estimate and iteration** live on a Projects board. With
  `github projects list-items` in the input, an issue and its board item are one
  item: the board's **Status** option sets `status` (Todo, Backlog, Ready and New
  are `TODO`; In Progress, Doing and In Review `IN_PROGRESS`; Done `DONE`; other
  options `UNKNOWN`), the first number field named **Estimate**, **Size** or
  **Story Points** the estimate in points, and its iteration field the
  iteration. A closed issue is `DONE` whatever the board says; an open one with no
  board is `TODO`. A board item whose issue isn't in the input still maps, from
  what the board carries.
- GitHub's newer **issue fields** have a REST API (`/repos/{owner}/{repo}/issues/{number}/issue-field-values`),
  but no toil command reads them yet, so OWI 0.1 doesn't map them.
- History from `github issue-events`: each `closed` and `reopened`.

### A history's item

A Jira changelog and a GitHub timeline don't name their issue, so wrap each as
`{ "key": "PAY-104", "history": <envelope> }`, or pass `--key` for one. An Azure
DevOps revision names its work item. A history whose item isn't in the input is
returned in `histories`, to attach to an item you already hold.

## Pointing a field at your own

Teams rarely keep the defaults, so these OWI fields can be pointed at any field:
`estimate`, `estimateUnit`, `priority`, `type`, `team`, `dueDate` and `iteration`.
The keys are the ones a dossier section's `fields` uses for its aliases
(`docs/dossiers.md`):

```json
{ "jira": { "fields": { "estimate": "customfield_10234", "estimateUnit": "points" } } }
```

`toil util owi map --field estimate=customfield_10234 --field estimateUnit=points`
passes the same thing on the CLI, `field` over MCP, and `fields` to `mapOwi`. The
value names a field as the record holds it: a Jira field id or registered name, an
Azure DevOps reference name, a GitHub project field's name. `estimateUnit` is
`points` when not given (`timeoriginalestimate` is always hours). An override that
names no OWI field, or a unit other than points, hours or days, is refused.

## OSLC CM mapping

OWI maps to [OSLC Change Management 3.0](https://docs.oasis-open-projects.org/oslc-op/cm/v3.0/os/change-mgt-spec.html)
(OASIS Standard, May 2021; namespace `http://open-services.net/ns/cm#`, prefix
`oslc_cm`). Each item is one `oslc_cm:ChangeRequest` whose resource URI is `url`.
This is a documented mapping only: no tracker serves OSLC, and toil has no export
command.

| OWI | OSLC CM |
|-----|---------|
| `owi`, `source`, `native`, `unmapped`, `history` | No equivalent: OWI's own bookkeeping. OSLC tracks history through its own resource versions, outside the resource |
| `id` | `dcterms:identifier` |
| `url` | The resource URI |
| `type` | The class: `BUG` is `oslc_cm:Defect`, `TASK` `oslc_cm:Task`, `STORY` and `EPIC` `oslc_cm:Enhancement`; `INCIDENT` and `OTHER` stay `oslc_cm:ChangeRequest` |
| `typeName` | `dcterms:type` (deprecated in 3.0, kept for readers) |
| `title` | `dcterms:title` |
| `body` | `dcterms:description` |
| `status` | `oslc_cm:status` (deprecated in 3.0); `oslc_cm:state` where a reader defines `oslc_cm:State` values |
| `statusCategory` | The state predicates: `oslc_cm:closed` is `DONE`, `oslc_cm:inProgress` is `IN_PROGRESS`; `TODO` is both false; `UNKNOWN` leaves both out |
| `resolution` | No equivalent. `oslc_cm:fixed` can't be told from it reliably (a Jira "Done" and a GitHub `not_planned` both close), so it is left out |
| (none) | `oslc_cm:approved`, `oslc_cm:reviewed` and `oslc_cm:verified`: no tracker records these as booleans, so they are left out |
| `assignee` | `dcterms:contributor` |
| `reporter` | `dcterms:creator` |
| `priority` | `oslc_cm:priority` |
| `estimate` | No equivalent |
| `labels` | `dcterms:subject` |
| `team` | No equivalent |
| `iteration` | `oslc_cm:affectsPlanItem`, pointing at the iteration as a plan item |
| `parent` | `oslc_cm:parent` |
| `children` | The inverse of `oslc_cm:parent` on each child |
| `links` | `relates` is `oslc_cm:relatedChangeRequest`; `blocks`, `duplicates` and `implements` have no CM property and are written as `oslc_cm:relatedChangeRequest`, losing the direction |
| `created` | `dcterms:created` |
| `updated` | `dcterms:modified` |
| `resolved` | `oslc_cm:closeDate` |
| `dueDate` | No equivalent |

## The sprint fixture

`test/fixtures/owi/` holds one sprint of placeholder work for anything that needs
realistic OWI items without a tracker, the Toil UI preview first:

- `sprint.ts` builds the input: the envelopes `jira get-issue`, `jira get-changelog`,
  `ado work list-iterations`, `ado work get-batch`, `ado work revisions`,
  `github get-issue`, `github issue-events` and `github projects list-items` print,
  as `util owi map` reads them (also served to its examples as `owi/sprint-42.jsonl`).
- `sprint-42.owi.json` is what `util owi map` makes of it: `{ owi, count, items }`,
  twenty-nine items that all validate. `test/owi.test.ts` regenerates it
  (`npx vitest run test/owi.test.ts -u`) and fails when it drifts.

Sprint 42 runs 2026-10-05 to 2026-10-16, across eight Jira issues (`corp-jira`,
project PAY), seven Azure DevOps work items (`corp-ado`, project Payments) and
five GitHub issues (`github`, imagile/payments-web, on project 7). It holds a
blocked chain in each of Jira and Azure DevOps (PAY-101 blocks PAY-102 blocks
PAY-103; 2302 precedes 2303), scope added mid-sprint (PAY-107, 2306,
payments-web#43), items carried over from Sprint 41 (PAY-104, 2304), unestimated
and orphaned items (PAY-107, payments-web#45), and finished and removed ones.
Nine more were finished in Sprints 40 and 41 (PAY-92, PAY-95, PAY-97, PAY-98, 2290,
2294, 2297, payments-web#36 and #38), with the histories that give throughput and
cycle time the weeks before Sprint 42.
Every host is a placeholder and every name invented.
