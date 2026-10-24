# Docs

## Authority order

When documents disagree, the earlier entry wins:

1. Owner decisions
2. `decisions/` — ADRs
3. `plans/` — implementation plans
4. `evidence/` — measurements, screenshots, state captures

## Filename conventions

- `decisions/NNNN-slug.md`
- `plans/YYYY-MM-DD-NNN-<type>-<slug>-plan.md`
- `evidence/<topic>/README.md`, with images and state files alongside

## Editing

Rewrite in place. No tombstones: a document states the current position, not the history of how it changed. ADRs record changes as dated amendment sections.
