#!/usr/bin/env bash
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
REPO="openclaw/openclaw"
FORCE=false
CACHE_BASE="${HOME}/.cache/qmd-gh-triage"
SYNC_INTERVAL=3600   # seconds (1 hour)
BODY_MAX_CHARS=4000
CLOSED_DAYS=7

# ── Args ──────────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)  REPO="$2"; shift 2 ;;
    --force) FORCE=true; shift ;;
    -h|--help)
      echo "Usage: sync.sh [--repo owner/repo] [--force]"
      echo "  --repo   GitHub repo (default: openclaw/openclaw)"
      echo "  --force  Bypass sync interval check"
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── Derived paths ─────────────────────────────────────────────────────────────
REPO_SLUG="${REPO//\//-}"
CACHE_DIR="${CACHE_BASE}/${REPO_SLUG}"
ISSUES_DIR="${CACHE_DIR}/issues"
PRS_DIR="${CACHE_DIR}/prs"
LAST_SYNC="${CACHE_DIR}/.last-sync"
COLLECTION="gh-${REPO_SLUG}"

# ── Dependency check ──────────────────────────────────────────────────────────
for cmd in gh jq qmd; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Error: ${cmd} is required but not found" >&2; exit 1; }
done

# ── Sync interval gate ────────────────────────────────────────────────────────
ensure_collection() {
  if ! qmd collection list 2>/dev/null | grep -q "$COLLECTION"; then
    qmd collection add "$CACHE_DIR" --name "$COLLECTION" --mask "**/*.md" 2>/dev/null
    qmd update 2>/dev/null
    qmd embed 2>/dev/null
  fi
}

if [[ "$FORCE" != true && -f "$LAST_SYNC" ]]; then
  # stat -f %m = macOS, stat -c %Y = GNU
  last_ts=$(stat -f %m "$LAST_SYNC" 2>/dev/null || stat -c %Y "$LAST_SYNC" 2>/dev/null || echo 0)
  now=$(date +%s)
  age=$(( now - last_ts ))
  if (( age < SYNC_INTERVAL )); then
    echo "Last sync $(( age / 60 ))m ago (threshold: $(( SYNC_INTERVAL / 60 ))m). Use --force to override."
    ensure_collection
    exit 0
  fi
fi

# ── Setup ─────────────────────────────────────────────────────────────────────
mkdir -p "$ISSUES_DIR" "$PRS_DIR"

# Cross-platform date: 7 days ago
if date -v-${CLOSED_DAYS}d +%Y-%m-%d >/dev/null 2>&1; then
  CUTOFF=$(date -v-${CLOSED_DAYS}d +%Y-%m-%d)
else
  CUTOFF=$(date -d "${CLOSED_DAYS} days ago" +%Y-%m-%d)
fi

echo "Syncing ${REPO} → ${CACHE_DIR}"
echo "  Cutoff for closed/merged: ${CUTOFF}"

# ── Fetch helpers ─────────────────────────────────────────────────────────────
ISSUE_FIELDS="number,title,body,state,labels,createdAt,updatedAt,author,closedAt"
PR_FIELDS="number,title,body,state,labels,createdAt,updatedAt,author,mergedAt,headRefName,closedAt"

fetch_issues() {
  local state="$1" search="${2:-}" tmp
  tmp=$(mktemp)
  local args=(--repo "$REPO" --state "$state" --json "$ISSUE_FIELDS")
  if [[ "$state" == "open" ]]; then
    args+=(--limit 10000)
  else
    args+=(--limit 2000)
    [[ -n "$search" ]] && args+=(--search "$search")
  fi
  gh issue list "${args[@]}" > "$tmp" 2>/dev/null
  echo "$tmp"
}

fetch_prs() {
  local state="$1" search="${2:-}" tmp
  tmp=$(mktemp)
  local args=(--repo "$REPO" --state "$state" --json "$PR_FIELDS")
  if [[ "$state" == "open" ]]; then
    args+=(--limit 10000)
  else
    args+=(--limit 2000)
    [[ -n "$search" ]] && args+=(--search "$search")
  fi
  gh pr list "${args[@]}" > "$tmp" 2>/dev/null
  echo "$tmp"
}

# ── Write markdown files (jq → awk split, no per-item shell overhead) ────────
# jq outputs a stream with <<<SPLIT:number>>> markers between file contents.
# awk reads this and directs lines to the correct output file in a single pass.

write_issues() {
  local json_file="$1" dir="$2" written_file="$3" max=$BODY_MAX_CHARS
  jq -r --argjson max "$max" '
    .[] |
    (.body // "" | .[0:$max]) as $body |
    ([.labels[].name] | join(", ")) as $labels |
    "<<<SPLIT:\(.number)>>>",
    "# Issue #\(.number): \(.title)",
    "",
    "State: \(.state)",
    (if $labels != "" then "Labels: \($labels)" else empty end),
    "Author: @\(.author.login)",
    "Created: \(.createdAt[0:10])",
    "Updated: \(.updatedAt[0:10])",
    (if .closedAt then "Closed: \(.closedAt[0:10])" else empty end),
    "",
    "## Body",
    "",
    $body
  ' "$json_file" | awk -v dir="$dir" -v wf="$written_file" '
    /^<<<SPLIT:[0-9]+>>>$/ {
      if (outfile) close(outfile)
      num = substr($0, 10, length($0) - 12)
      outfile = dir "/" num ".md"
      print num >> wf
      next
    }
    outfile { print > outfile }
  '
}

write_prs() {
  local json_file="$1" dir="$2" written_file="$3" max=$BODY_MAX_CHARS
  jq -r --argjson max "$max" '
    .[] |
    (.body // "" | .[0:$max]) as $body |
    ([.labels[].name] | join(", ")) as $labels |
    "<<<SPLIT:\(.number)>>>",
    "# PR #\(.number): \(.title)",
    "",
    "State: \(.state)",
    (if $labels != "" then "Labels: \($labels)" else empty end),
    "Author: @\(.author.login)",
    "Created: \(.createdAt[0:10])",
    "Updated: \(.updatedAt[0:10])",
    (if .mergedAt then "Merged: \(.mergedAt[0:10])" else empty end),
    (if (.closedAt and (.mergedAt | not)) then "Closed: \(.closedAt[0:10])" else empty end),
    (if .headRefName then "Branch: \(.headRefName)" else empty end),
    "",
    "## Body",
    "",
    $body
  ' "$json_file" | awk -v dir="$dir" -v wf="$written_file" '
    /^<<<SPLIT:[0-9]+>>>$/ {
      if (outfile) close(outfile)
      num = substr($0, 10, length($0) - 12)
      outfile = dir "/" num ".md"
      print num >> wf
      next
    }
    outfile { print > outfile }
  '
}

# ── Cleanup stale files ──────────────────────────────────────────────────────
cleanup_stale() {
  local dir="$1" written_file="$2" removed=0
  if [[ ! -f "$written_file" ]]; then return; fi
  for f in "${dir}"/*.md; do
    [[ -f "$f" ]] || continue
    local num
    num=$(basename "$f" .md)
    if ! grep -qx "$num" "$written_file" 2>/dev/null; then
      rm -f "$f"
      (( removed++ )) || true
    fi
  done
  if (( removed > 0 )); then
    echo "  Removed ${removed} stale files from ${dir##*/}/"
  fi
}

# ── Main: fetch issues ───────────────────────────────────────────────────────
echo "Fetching open issues..."
f_open_issues=$(fetch_issues open)
echo "  $(jq length "$f_open_issues") open issues"

echo "Fetching recently closed issues (since ${CUTOFF})..."
f_closed_issues=$(fetch_issues closed "closed:>=${CUTOFF}")
echo "  $(jq length "$f_closed_issues") recently closed issues"

# Merge, deduplicate, write
f_all_issues=$(mktemp)
jq -s '.[0] + .[1] | unique_by(.number)' "$f_open_issues" "$f_closed_issues" > "$f_all_issues"
total_issues=$(jq length "$f_all_issues")
echo "  Writing ${total_issues} issue files..."

issues_written=$(mktemp)
write_issues "$f_all_issues" "$ISSUES_DIR" "$issues_written"
cleanup_stale "$ISSUES_DIR" "$issues_written"

# ── Main: fetch PRs ──────────────────────────────────────────────────────────
echo "Fetching open PRs..."
f_open_prs=$(fetch_prs open)
echo "  $(jq length "$f_open_prs") open PRs"

echo "Fetching recently merged PRs (since ${CUTOFF})..."
f_merged_prs=$(fetch_prs merged "merged:>=${CUTOFF}")
echo "  $(jq length "$f_merged_prs") recently merged PRs"

echo "Fetching recently closed PRs (since ${CUTOFF})..."
f_closed_prs=$(fetch_prs closed "closed:>=${CUTOFF}")
echo "  $(jq length "$f_closed_prs") recently closed PRs"

# Merge, deduplicate, write
f_all_prs=$(mktemp)
jq -s '.[0] + .[1] + .[2] | unique_by(.number)' "$f_open_prs" "$f_merged_prs" "$f_closed_prs" > "$f_all_prs"
total_prs=$(jq length "$f_all_prs")
echo "  Writing ${total_prs} PR files..."

prs_written=$(mktemp)
write_prs "$f_all_prs" "$PRS_DIR" "$prs_written"
cleanup_stale "$PRS_DIR" "$prs_written"

# ── Mark sync time (before indexing, so slow embeds don't invalidate cache) ──
touch "$LAST_SYNC"

# Cleanup temp files
rm -f "$f_open_issues" "$f_closed_issues" "$f_all_issues" \
      "$f_open_prs" "$f_merged_prs" "$f_closed_prs" "$f_all_prs" \
      "$issues_written" "$prs_written"

total=$(( total_issues + total_prs ))
echo "Files written: ${total} (${total_issues} issues, ${total_prs} PRs)"

# ── Index with qmd ───────────────────────────────────────────────────────────
echo "Updating qmd index..."
if qmd collection list 2>/dev/null | grep -q "$COLLECTION"; then
  qmd update 2>/dev/null
else
  qmd collection add "$CACHE_DIR" --name "$COLLECTION" --mask "**/*.md" 2>/dev/null
  qmd update 2>/dev/null
fi

echo "Generating embeddings (this may take a few minutes on first run)..."
qmd embed 2>/dev/null

echo "Done. Collection: ${COLLECTION}"
