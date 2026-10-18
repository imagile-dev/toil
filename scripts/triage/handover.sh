#!/usr/bin/env bash
# Hands the triage agent's work to the next job, after the agent has run. By
# then nothing in the working tree can be trusted to run, so this uses shell
# utilities only (no git, no node), and the workflow runs a copy made before
# the agent started, after checking its hash (scripts/triage/steps.mjs, prepare).
#
# Env: AGENT (the agent step's outcome), PRISTINE (the tree before the agent),
# WORKSPACE (the tree after), OUT (the handover folder). Writes to OUT:
#   changes.tar   every added or changed regular file, ustar
#   deleted.txt   every path removed
#   agent-ok      only when the agent step succeeded
#   decision.json, comment.md, pr-title.txt, pr-body.md   as the agent wrote them
#
# The diff of two folders, done by hand with checksums, as the file room would.
set -euo pipefail
export LC_ALL=C
: "${AGENT:?}" "${PRISTINE:?}" "${WORKSPACE:?}" "${OUT:?}"
mkdir -p "$OUT"
if [ "$AGENT" = "success" ]; then echo ok > "$OUT/agent-ok"; fi

hash_all() {
  (cd "$1" && find . -type f -not -path './.git/*' -not -path './node_modules/*' -not -path './.triage-out/*' -not -path './.triage-in/*' -print0 \
    | xargs -0 -r sha256sum 2>/dev/null || true) | sed -E 's/^([0-9a-f]+) [ *]/\1 /' | sort
}
paths() { sed -E 's/^[0-9a-f]+ //' "$1" | sort; }

TMP="$(mktemp -d)"
hash_all "$PRISTINE" > "$TMP/before.txt"
hash_all "$WORKSPACE" > "$TMP/after.txt"
# Added or changed: a hash and path in after that isn't in before. Deleted: a path only in before.
comm -13 "$TMP/before.txt" "$TMP/after.txt" | sed -E 's/^[0-9a-f]+ //' > "$TMP/changed.txt"
comm -23 <(paths "$TMP/before.txt") <(paths "$TMP/after.txt") > "$OUT/deleted.txt"
tar --format=ustar --no-recursion -cf "$OUT/changes.tar" -C "$WORKSPACE" --files-from "$TMP/changed.txt"
for f in decision.json comment.md pr-title.txt pr-body.md; do
  if [ -f "$WORKSPACE/.triage-out/$f" ] && [ ! -L "$WORKSPACE/.triage-out/$f" ]; then head -c 100000 "$WORKSPACE/.triage-out/$f" > "$OUT/$f"; fi
done
echo "Changed: $(wc -l < "$TMP/changed.txt" | tr -d ' ') file(s); deleted: $(wc -l < "$OUT/deleted.txt" | tr -d ' ')."
rm -rf "$TMP"
