# Skills

Skills are domain knowledge modules. They serve two purposes:

1. **For the implementing agent (you):** read the relevant skill file before implementing the corresponding system. They document sharp edges, non-obvious patterns, and the "why" behind decisions that are not obvious from the SDD alone.

2. **For Finch's runtime LLM agents:** the content of these files is the source material for skill records seeded into the database. At runtime, `AgentDispatcherService` injects the `content` field of each active skill into the relevant agent's system prompt.

---

## Current skills

| File | Scope | Read when |
|---|---|---|
| `temporal-patterns.md` | Temporal workflow determinism, signals, activities, parallel scheduling, idempotent audit activities | Before any work in `workflow/` or any Temporal Activity |
| `nestjs-patterns.md` | NestJS DI, module structure, circular dependency avoidance, Temporal worker lifetime, `WorkflowClient` injection | Before any new NestJS module, service, guard, or controller |

---

## What a skill is not

A skill is not a rule. Rules (in `RULES.md`) are constraints — violations are defects. Skills are knowledge that improves quality — they help avoid mistakes but are not enforcement mechanisms.

A skill is not a spec. The SDD and PRD are the specs. A skill is a focused guide to the sharp edges within a specific technical domain.

---

## Adding a new skill

Create a new `.md` file in this directory. Structure:

1. One-line summary and when to read it
2. The fundamental rule — the single most important thing
3. Concrete patterns — short, copy-pasteable examples with explanations
4. Anti-patterns — explicit bad patterns with a brief explanation of why they fail

Keep skills under 150 lines. If a skill exceeds 150 lines, split it into two focused skills.

When the skill is ready, seed it as a `Skill` record in `apps/api/prisma/seed.ts` with the appropriate `applicable_phases` so it is available to Finch's runtime agents.
