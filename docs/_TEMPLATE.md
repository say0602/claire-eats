---
title: "<Feature Title>"
status: draft # draft | active | implemented | abandoned
date: YYYY-MM-DD
app: "<app name or slug>"
tags: [] # optional: ["realtime", "db", "frontend"]
---

# <Feature Title>

## AI Context

*Key files and directories the implementing agent should read first.*

**Architecture / setup docs (include when relevant to the work):**
- `<link-to-your-architecture-docs>.md`
- `<link-to-your-setup-docs>.md`

**Plan-specific files (replace these examples with files specific to this plan):**
- `src/...`
- `server/...`

## Goal

What we're building and why.

## Design Decisions

Key architectural choices and trade-offs.

Prompt yourself to cover any relevant decisions:
- Routing strategy (single-page vs multi-page)
- Data model (what needs to persist, and where)
- UI state vs persisted state
- Error handling + empty states

## Non-goals

What we are explicitly not doing in this iteration.

## Implementation Steps

For larger plans, prefer dividing the work into explicit **phases** (each with its own checklist). This makes sequencing, dependency boundaries, and parallelization clearer.

Example structure:
- **Phase 0 — Foundations** (project setup, scaffolding, core types)
- **Phase 1 — Core implementation** (main features)
- **Phase 2 — Hardening** (tests, performance, docs, UX polish)

1. [ ] Step 1: Description
2. [ ] Step 2: Description
3. [ ] Step 3: Description

## Success Criteria

How we'll know this is working.

## Open Questions

Unresolved decisions, unknowns, and follow-ups. Remove this section when all questions are answered.

