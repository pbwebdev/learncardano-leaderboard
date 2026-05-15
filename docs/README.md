# Project documentation

Read order for any new task:

1. **`AGENTS.md`** (root) — Critical landmine warnings. ~30 seconds to read. Sets the right level of caution for the rest.

2. **`CLAUDE.md`** (root) — Full project contract. Architecture, tech stack, file-by-file port log from the sibling DRep Dashboard, data model, conventions, phasing, deploy chain. ~10 minutes to read carefully, but this is the single source of truth for what to build and how.

3. **`GOTCHAS.md`** (root) — The field manual for not stepping on mines. 21 specific failure modes with the bite, the fix, and a smell test for each. Read once start-to-finish; revisit relevant sections when working in those areas.

4. **`docs/brief.md`** — Product brief. The "what" and "why" for users. Read before designing UI or naming things.

5. **`docs/lifted-from-drep-dashboard.md`** — Port log. Tells you which files come verbatim from the sibling repo, which need minimal renames, and which are extended. **Check this before writing anything from scratch** — the sibling has probably already solved it.

6. **`docs/task-types.md`** — Spec for every task verification method (which Cardano endpoints, which OAuth flows, which webhook shapes).

7. **`docs/admin-runbook.md`** — How Peter operates the admin panel day-to-day. Useful for understanding what admin features actually need to exist.

## When something isn't in the docs

1. Check the sibling repo (`Z:\cardano\cardano-drep-dashboard\` or `/home/aiagent/.openclaw/workspace/cardano-drep-dashboard/`). Most patterns already exist there.
2. Search the relevant CIP at https://cips.cardano.org/ rather than guessing API behaviour.
3. Ask Peter — for product decisions, naming, partner-relationship implications, anything where ecosystem trust is at stake.
4. If you debug something for more than 30 minutes, add a new entry to `GOTCHAS.md`.

## When in doubt

Prefer boring code. The sibling project's style is functional, explicit, and readable. Don't add abstractions until duplication actually hurts. Don't introduce new dependencies without permission. Don't rewrite a working file because you'd "do it differently".
