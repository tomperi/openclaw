---
name: gh-triage
description: "Triage GitHub issues and PRs by finding related/duplicate items via local semantic search. Use when: (1) investigating a bug or feature request to find existing issues, (2) checking for duplicates before filing, (3) finding PRs that address a specific issue, (4) exploring what's been reported about a topic. Triggers on: triage, duplicate, related issues, existing issue, has anyone reported, similar bug, prior art, feature request investigation, what issues exist for, find PRs related to."
---

# GitHub Issue/PR Triage

Find related issues and PRs in a GitHub repository using local semantic + keyword search via `qmd`.

## Dependencies

- `gh` (authenticated)
- `jq`
- `qmd`

## Workflow

### 1. Sync

Run the sync script. It auto-skips if synced within the last hour.

```bash
bash <skill_path>/scripts/sync.sh [--repo owner/repo] [--force]
```

Default repo: `openclaw/openclaw`. Data cached at `~/.cache/qmd-gh-triage/<owner>-<repo>/`.

The collection name is `gh-<owner>-<repo>` (e.g., `gh-openclaw-openclaw`).

### 2. Search

Use the user's description as a search query. Run both semantic and keyword searches for broader coverage:

```bash
# Semantic search (recommended — understands intent, synonyms)
qmd query "<user description>" -c gh-openclaw-openclaw -n 15 --json

# Keyword fallback (exact term matching, useful for error messages or specific identifiers)
qmd search "<specific term>" -c gh-openclaw-openclaw -n 10 --json
```

Refine the query if needed — rephrase, try synonyms, or extract key terms from the user's description. Run multiple searches with different phrasings if the first results seem incomplete.

### 3. Read top hits

Read the full `.md` files for the top 5-8 results to understand context:

```bash
qmd get <docid>   # docid from search results
```

### 4. Cross-reference issues ↔ PRs

For top issue hits, check if any PRs reference them:

```bash
qmd search "#<issue_number>" -c gh-openclaw-openclaw -n 5 --json
```

Look for patterns in PR bodies: `Fixes #NNN`, `Closes #NNN`, `Related to #NNN`.

For top PR hits, note which issues they reference in their body text.

### 5. Summarize

Present results as a structured summary:

**Related issues** — ranked by relevance:

- Issue number, title, state (open/closed), labels, brief description of relevance

**Related PRs** — linked to those issues or independently matching:

- PR number, title, state (open/merged/closed), which issues it addresses

**Assessment:**

- Whether the user's request appears to be a duplicate of an existing issue
- Whether it's partially addressed by existing work
- Whether it's genuinely new
- Suggest which existing issue to follow or comment on, if applicable
