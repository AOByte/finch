# Product Requirements Document
## Finch — Agentic Harness for Software Development Teams

**Status:** Draft  
**Version:** 0.3 — Final  
**Date:** April 2026  
**Framework Reference:** TAPES v1 (Trigger · Acquire · Plan · Execute · Ship)

---

## Table of Contents

1. Executive Summary
2. Problem Statement
3. Goals and Non-Goals
4. TAPES Framework Fidelity Contract
5. System Architecture
6. Phase Requirements
7. Clarification Gate Protocol
8. Agent Architecture
9. Internal Memory System
10. Connector System and Integrations
11. Skills, Rules, and Agent Composition
12. Audit Log and Observability
13. Resumability and State Management
14. User Interface Requirements
15. Non-Functional Requirements
16. Reference Implementation Scope
17. Extensibility Model
18. Delivery Milestones
19. Open Questions

---

## 1. Executive Summary

This document specifies the requirements for a Finch software product that implements the TAPES framework as a production-grade agentic harness for software development teams. The product receives tasks through configured trigger sources, autonomously acquires context, produces an explicit plan, executes implementation work, and ships a deliverable — all while maintaining structured human-in-the-loop checkpoints wherever the agent identifies a gap in its understanding.

The reference implementation uses Slack as the trigger source, Jira as the primary context acquisition source, GitHub as the execution and shipping backend, and an internal vector-based memory store as the persistent knowledge layer. All four integrations are implemented against abstract interfaces so that any component can be swapped or extended without modifying the orchestration core.

The product is not a chatbot. It is a phased orchestration engine with explicit lifecycle semantics, persistent agent memory, a deep connector system, configurable per-phase agent pipelines, a pluggable LLM provider system, multi-repository execution support, and a complete audit trail. A single stateful master orchestrator owns the entire session from Trigger to Ship.

---

## 2. Problem Statement

Most AI coding agents today are either overconfident or unreliably cautious. The overconfident ones act on incomplete context, produce plausible-looking but subtly wrong output, and leave teams debugging regressions they cannot easily attribute. The overly cautious ones interrupt work unpredictably, ask questions that were already answered, and generate more overhead than value. Neither type learns from experience. Every task is treated as stateless; decisions and conventions accumulated over prior cycles are invisible to the agent handling today's task.

Beyond behavioral problems, existing tools offer no meaningful observability. When an agent makes a decision — to proceed, to modify a file, to interpret an ambiguous requirement a particular way — there is no structured record of why. Trust cannot be built on outputs alone; it requires visibility into reasoning.

The TAPES framework addresses all of these problems at the architectural level. This product's job is to implement TAPES faithfully and completely.

---

## 3. Goals and Non-Goals

### Goals

- Implement the TAPES five-phase lifecycle (Trigger, Acquire, Plan, Execute, Ship) as the core orchestration model.
- Implement all three clarification gates (A, P, E) with identical trigger semantics: the agent fires a gate when it self-identifies a context gap it cannot resolve independently.
- Implement a persistent internal memory system that every agent reads from and writes to, enabling gate frequency to decrease over time as the system accumulates domain knowledge.
- Implement a connector system with abstract interfaces for triggers, context sources, execution backends, ship targets, memory providers, and LLM providers.
- Deliver a reference implementation with Slack (trigger), Jira (acquire), GitHub (execute and ship), and internal vector memory.
- Implement a full audit log covering every phase transition, every gate firing, every clarification exchange, and every agent decision.
- Implement complete resumability: gate firings are pauses, not restarts. No prior work is discarded on resume.
- Support backward phase traversal (e.g., Execute to Plan to Acquire) when new information warrants it.
- Provide a web UI that surfaces run state, audit logs, connector configuration, memory contents, and skill and rule management.
- Support the attachment of user-defined skills (domain knowledge modules) and rules (behavioral constraints) to agents.
- Allow users to configure which LLM provider and model backs each individual agent independently.
- Allow users to configure multiple agents operating within a single phase layer, with those agents passing the canonical phase artifact between them additively.
- Expose a single stateful master orchestrator that owns all session state, phase transitions, artifact custody, and gate logic for the full lifetime of a run.
- Support multi-repository execution where the presence of multiple registered repos in harness config activates the multi-repo coordination logic.

### Non-Goals

- This product is not a general-purpose AI assistant or chatbot interface.
- This product does not attempt to build a new LLM or fine-tune an existing one.
- The initial version does not support multi-user concurrent editing of harness configuration.
- The initial version does not provide native mobile applications.
- The initial version does not implement memory retention or expiry policies.
- The initial version does not attribute gate responses to specific human identities.
- This product does not attempt to replace existing project management tools; it integrates with them.

---

## 4. TAPES Framework Fidelity Contract

The following constraints are derived directly from the TAPES specification paper. They are treated as hard requirements. Any implementation decision that conflicts with these is a defect, not an acceptable tradeoff.

**FC-01.** The Trigger phase is stateless. It normalizes an inbound signal into a task descriptor and passes it forward. It does not write to memory, does not persist run state, and has no clarification gate.

**FC-02.** All three clarification gates (A, P, E) fire under the identical condition: the agent has self-identified a context gap that it cannot resolve from available sources. No gate has a distinct or specialized trigger condition. This symmetry is intentional and must not be broken.

**FC-03.** The plan produced in the Plan phase does not require human approval before execution proceeds. Gate P fires only when the agent lacks the context to produce a coherent plan — not to seek human sign-off on the plan itself. Humans may observe the plan in the audit log and may stop execution from the UI at any point, but the system does not proactively reach out to humans after the plan is produced. Any UI element that presents the plan must be clearly scoped to observability, not approval.

**FC-04.** The Execute phase is strictly bounded by the plan artifact. The agent cannot silently expand scope, modify components not covered by the plan, or change approach. If execution reveals that the plan is wrong or incomplete, Gate E fires and the plan is formally revised. Silent deviation is never permitted.

**FC-05.** Gate firings are pauses, not restarts. When a gate fires, the full agent state is serialized and stored. When the human responds, the agent resumes from exactly where it left off, carrying all prior work forward. No completed work is discarded.

**FC-06.** Backward phase traversal is permitted and expected. A Gate E resolution may require returning to Plan before execution resumes. A Gate P resolution may require returning to Acquire. This is not a violation of resumability; it is a consequence of new information. What resumability prohibits is a full reset, not intelligent traversal.

**FC-07.** The Ship phase has no clarification gate. By the time the agent reaches Ship, all gaps are resolved, the plan is finalized, execution is verified, and no outstanding unknowns remain. Ship is deterministic given a passing Execute phase.

**FC-08.** The system must support incremental trust: as the agent accumulates domain knowledge through memory, gate frequency should naturally decrease. The framework does not prescribe how this is implemented, but the design must support it.

**FC-09.** The gate condition is framework-owned and locked. It is injected as a protected preamble into every agent's system prompt by the orchestration core at instantiation time. Users cannot edit, override, or remove the gate condition through any UI or configuration surface. This is a constitutional constraint, not a preference.

---

## 5. System Architecture

The system is organized into five layers. Each layer has a clear responsibility boundary and communicates with adjacent layers through defined interfaces.

### Layer 1: Web Application (UI)
A browser-based interface that provides run monitoring, connector configuration, memory browsing, audit log access, skill and rule management, per-agent LLM configuration, per-phase agent pipeline configuration, and clarification gate response handling. Real-time updates are delivered over WebSocket.

### Layer 2: Orchestration Core (API Server)
The deterministic backbone of the system and the single owner of all session state. Contains:

**RunManager** — creates, persists, and retrieves runs. A run is a single TAPES lifecycle instance from Trigger to Ship. The RunManager is the single source of truth for the state of any run at any point in time. No agent holds authoritative session state; the RunManager does.

**PhaseRouter** — advances runs through phases, enforces phase ordering, handles backward traversal. The PhaseRouter decides which phase executes next and constructs the correct input artifact for that phase, carrying all prior work forward.

**GateController** — detects gate conditions reported by agents, serializes full agent state, dispatches clarification requests to the appropriate human channel, and restores state on resolution. The GateController also determines whether a gate resolution requires backward traversal and instructs the PhaseRouter accordingly.

**AgentDispatcher** — instantiates and invokes the configured agent pipeline for a given phase. For phases with multiple configured agents, the AgentDispatcher manages their sequential execution, passes the accumulated canonical artifact from each agent to the next, and collects the final phase output artifact. Injects the locked gate condition preamble into every agent system prompt before invocation.

**AuditLogger** — append-only event stream. Every state transition, gate firing, agent decision, artifact handoff, and connector call is logged with full payload.

The orchestration core is not an LLM. It is deterministic software that enforces TAPES constraints by code, not by prompting. Agents are stateless workers. The orchestration core is the session brain.

### Layer 3: Agent Layer
Five agents in the reference implementation, one per TAPES phase by default. Each agent is an LLM-powered component with its own configured LLM provider and model, its own system prompt, its own tool set, its own memory access scope, and its own attached skills and rules. Agents do not share a context window. They communicate through canonical phase artifacts passed via the AgentDispatcher and RunManager.

Each phase layer supports a configurable pipeline of multiple agents rather than a single fixed agent. All agents within a phase pipeline — whether operating as the sole agent or as one step in a multi-agent pipeline — speak the same artifact language. They all receive and produce the canonical artifact type for their phase. Each agent receives the accumulated artifact from the previous agent in the pipeline, enriches or refines it, and passes it forward. The last agent's output is the canonical artifact handed to the next phase. This means any agent built for a phase can be used standalone or as part of a pipeline without modification.

- **TriggerAgent** — normalizes inbound signal into TaskDescriptor
- **AcquireAgent** (default, expandable to pipeline) — receives and enriches ContextObject from memory and connectors; conducts self-assessment
- **PlanAgent** (default, expandable to pipeline) — receives and enriches PlanArtifact from ContextObject; reads memory for domain conventions
- **ExecuteAgent** (default, expandable to pipeline) — implements work bounded by PlanArtifact; each agent in pipeline receives and enriches VerificationReport in progress
- **ShipAgent** — publishes output; writes memory update from completed cycle

### Layer 4: Connector System
Abstract interfaces for each integration category, each with one or more reference implementations and a documented extension model. The LLM provider is itself a connector in this layer.

- **TriggerConnector** — Slack (reference), Webhook, Cron
- **AcquireConnector** — Jira (reference), GitHub read, Confluence, internal docs
- **ExecuteConnector** — GitHub (reference)
- **ShipConnector** — GitHub Pull Request (reference)
- **MemoryConnector** — Internal vector store (reference), extensible to external providers
- **LLMConnector** — Anthropic Claude (reference), OpenAI (reference), any provider implementing the interface

### Layer 5: Persistence
- **RunStore** — full run state, phase artifacts, gate states, agent pipeline configuration per run (PostgreSQL)
- **AuditLog** — append-only event log
- **VectorMemory** — embeddings-based memory store with staging area per run, merged at Ship
- **ConfigStore** — harness configuration, connector credentials, skills, rules, per-agent LLM assignments, registered repositories

---

## 6. Phase Requirements

### 6.1 Trigger Phase

The Trigger phase is the entry point. Its only job is to receive an inbound signal and produce a TaskDescriptor. It is stateless and has no gate.

**TaskDescriptor schema:** task_id, run_id, raw_input, normalized_intent, source (type, channel_id, message_id, author_id, timestamp), harness_id.

**TR-01.** The TriggerConnector interface accepts any inbound signal and returns a TaskDescriptor. Connector implementations must not embed business logic; normalization of intent is the responsibility of TriggerAgent.

**TR-02.** Slack reference connector: authenticate via Slack App Bot Token and Signing Secret. Subscribe to message events in configured channels via Events API. Filter by configurable trigger prefix. On match, extract message content, channel, author, and thread context and pass to TriggerAgent.

**TR-03.** Webhook reference connector: expose a POST endpoint at /api/trigger/{harness_id}. Validate requests using HMAC-SHA256 signature. Accept JSON body with at minimum a "message" field. Return TaskDescriptor.

**TR-04.** Cron reference connector: define scheduled triggers in harness config. Fire on schedule with a synthetic message payload defined at configuration time.

**TR-05.** The Trigger phase must not write to AgentMemory, must not create gate events, and must not persist any state beyond the TaskDescriptor itself.

**TR-06.** The TriggerConnector interface must be fully documented, with a clear extension guide and a minimal example implementation included in the codebase.

---

### 6.2 Acquire Phase

AcquireAgent receives the TaskDescriptor and builds a ContextObject: the complete working knowledge the system needs to plan and execute the task. It queries sources in priority order, conducts a structured self-assessment, and fires Gate A if any critical dimension is insufficient.

In multi-repository harnesses, AcquireAgent is additionally responsible for building a repo map — a structured understanding of which components, domains, and file paths live in which registered repository. This repo map is a first-class dimension of the ContextObject and is used by PlanAgent to assign sub-tasks to repos.

**ContextObject schema:** context_id, run_id, task_descriptor, sources (connector_id, query, result, retrieved_at), memory_hits (memory_id, relevance_score, content), dimensions (requirements_clarity, technical_constraints, affected_components, risk_signals, team_conventions, repo_routing — each rated sufficient / insufficient / unknown), sufficiency_assessment (boolean), gaps (dimension, description, question), repo_map (repo_id, description, owned_paths, owned_domains — present only in multi-repo harnesses).

**AC-01.** AcquireAgent must query AgentMemory before any external connector. Memory results are highest-priority inputs to context assembly.

**AC-02.** AcquireAgent queries all enabled AcquireConnectors in configured priority order. Each connector result is attached to the ContextObject with source metadata.

**AC-03.** Jira reference connector for Acquire: given a Jira issue key extracted from the task, fetch issue summary, description, acceptance criteria, issue type, priority, labels, components, sprint, epic, linked issues, subtasks, comments, assignee, and reporter.

**AC-04.** AcquireAgent conducts a structured self-assessment after all connectors have been queried. The self-assessment evaluates sufficiency across all dimensions in the ContextObject schema.

**AC-05.** If any dimension is rated insufficient and the gap cannot be resolved from available sources, Gate A fires. AcquireAgent formulates a specific, minimal question targeting the identified gap. The question must reference the exact missing information and must not be open-ended.

**AC-06.** Gate A resolution enriches the ContextObject with the human's answer. The self-assessment reruns. The phase does not advance to Plan until all dimensions are rated sufficient.

**AC-07.** Gate A may fire multiple times within a single Acquire phase if multiple gaps are identified sequentially. Each firing is a separate gate event in the audit log.

**AC-08.** Multi-repo repo map construction: when two or more repositories are registered in harness config, AcquireAgent uses the GitHub AcquireConnector to inspect each repo. It fetches repo metadata, top-level file structure, package manifests, and import graphs for paths relevant to the task. It does not perform exhaustive inspection; depth is proportional to relevance. The result is a repo_map in the ContextObject assigning components and paths to repos. If AcquireAgent cannot confidently assign a component to a repo, the repo_routing dimension is rated insufficient and Gate A fires with a specific question identifying the ambiguous component.

**AC-09.** The Acquire phase layer supports a configurable multi-agent pipeline. All agents in the pipeline receive and produce ContextObject. Each agent receives the ContextObject as enriched by the previous agent, adds its contribution, and passes it forward. Any agent in the pipeline may surface a context gap that triggers Gate A. The gate fires at the phase level; the human sees one coherent question.

**AC-10.** The AcquireConnector interface must be documented and extensible. Anticipated extensions: Confluence, Notion, internal code search, semantic search over past PRs.

---

### 6.3 Plan Phase

PlanAgent receives the ContextObject and produces a PlanArtifact. The plan is a binding contract for the Execute phase. It is the agent's own commitment. No human approval is required or solicited.

In multi-repository harnesses, every sub-task in the PlanArtifact carries a repo assignment derived from the repo_map in the ContextObject. A plan with any unassigned sub-task is invalid and cannot leave the Plan phase.

**PlanArtifact schema:** plan_id, run_id, version, created_at, sub_tasks (id, description, affected_files, repo_id, approach, order), affected_components, risk_assessment (risk_level, identified_risks with description and mitigation), estimated_scope (files_to_modify, estimated_complexity), proposed_approach, scope_boundaries (excluded_paths, excluded_behaviors, rationale), verification_conditions (id, type, description, assertion, command).

**PL-01.** PlanArtifact must include explicit scope boundaries — a list of files, modules, and behaviors the Execute agent is prohibited from modifying. These are enforced before every action, not merely advisory.

**PL-02.** PlanArtifact must include at least one verification condition. Verification conditions support generic assertions including arbitrary shell commands and custom scripts.

**PL-03.** The plan does not require human approval to proceed. The system must not implement a waiting-for-plan-approval state. The plan is visible in the audit log. Humans may stop execution from the UI at any point but the system does not proactively notify them when the plan is produced.

**PL-04.** Gate P fires under the same condition as Gates A and E: the agent has identified a context gap it cannot resolve in order to produce a coherent plan. It does not fire because the plan seems risky or because a human might disagree with it.

**PL-05.** PlanArtifact is stored in RunStore with version history. If Gate E triggers backward traversal to Plan, a new version is created. Prior versions are retained. The audit log records which version of the plan was active during each execution attempt.

**PL-06.** PlanAgent reads AgentMemory for: prior approaches to similar tasks, known risky paths in the codebase, team conventions on PR scope and naming, reviewer assignment patterns.

**PL-07.** The plan_id is used to name the feature branch created during Execute (e.g., tapes/{plan_id}). In multi-repo runs, the same branch name is used across all repos for consistency.

**PL-08.** The Plan phase layer supports a configurable multi-agent pipeline. All agents in the pipeline receive and produce PlanArtifact. Each agent receives the PlanArtifact as enriched by the previous agent, refines it, and passes it forward.

---

### 6.4 Execute Phase

ExecuteAgent receives the PlanArtifact and implements the work. It is strictly bounded by the plan. Every action is checked against the plan before execution. All modifications are logged at the time of action.

In multi-repository harnesses, the ExecuteAgent works sub-task by sub-task, switching GitHub connector context when crossing a repo boundary. Each repo gets its own feature branch. The orchestrator holds all branches open until all sub-tasks across all repos have passed verification before handing off to Ship.

**EX-01.** Before any file operation, ExecuteAgent checks the target path against scope_boundaries.excluded_paths. Any attempt to operate on an excluded path fires Gate E — it does not proceed silently or skip the file.

**EX-02.** Before any behavioral change, ExecuteAgent checks against scope_boundaries.excluded_behaviors. A match fires Gate E.

**EX-03.** GitHub reference connector for Execute: authenticate via GitHub App. Clone the target repository to an ephemeral workspace. Create a feature branch named tapes/{plan_id}. Apply file modifications using structured edit operations. Run configured verification steps after each sub_task.

**EX-04.** ExecuteAgent executes sub_tasks in the order defined in the PlanArtifact. Sub_task order can only be changed by re-entering Plan.

**EX-05.** Gate E fires when the agent identifies a context gap mid-execution. This is distinct from a technical failure. A flaky test is a technical issue handled by retry. A test failing because the expected behavior of a module is ambiguous is a context gap that fires Gate E.

**EX-06.** On Gate E resolution: if the resolution is additive (answers a question without changing the plan), execution resumes in place. If the resolution invalidates any element of the PlanArtifact, the GateController enforces backward traversal to Plan before execution resumes.

**EX-07.** Execution is complete only when all verification_conditions in the PlanArtifact are confirmed met across all repos. The ExecuteAgent produces a VerificationReport as its output artifact.

**EX-08.** Every file modification is logged to the AuditLog with: file path, repo_id, operation type, before content hash, after content hash, full diff, timestamp, and the sub_task_id that motivated the change.

**EX-09.** Verification conditions support generic executable assertions: lint commands, test runners, build commands, type checkers, and arbitrary shell commands or custom scripts defined in the PlanArtifact.

**EX-10.** The ExecuteConnector interface must be documented and extensible. Anticipated extensions: Terraform, database migration runners, documentation generators.

**EX-11.** The Execute phase layer supports a configurable multi-agent pipeline. All agents in the pipeline receive and produce VerificationReport. Each agent receives the VerificationReport as built by the previous agent and adds its contributions.

---

### 6.5 Ship Phase

ShipAgent receives the VerificationReport and the PlanArtifact and publishes the deliverable. It then writes a memory update capturing learnings from the completed cycle.

In multi-repository harnesses, the orchestrator fans out to N parallel ShipAgents, one per repo. Each ShipAgent opens its PR independently. The orchestrator marks the run COMPLETED when all ShipAgents have fired. Individual Ship failures are surfaced in the audit log and the UI for human handling; they are not gates and do not block run completion.

**SH-01.** ShipAgent may only begin when the PhaseRouter has confirmed that the VerificationReport marks all verification_conditions as passing across all repos. This check is enforced by the orchestration core, not ShipAgent.

**SH-02.** GitHub ShipConnector: open a pull request on the target repository. PR title is derived from normalized_intent in the TaskDescriptor. PR body includes: link to the originating task (Slack message, Jira issue), the full plan summary, list of modified files, verification results, run_id for cross-reference, and a link to the full audit log entry. In multi-repo runs, each PR cross-references the other PRs in its body.

**SH-03.** ShipAgent writes a MemoryUpdate to the run's memory staging area after each successful Ship. The MemoryUpdate includes: task type, approach taken, files affected per repo, conventions discovered, gate patterns (which dimensions triggered which gates and what resolved them), and outcome. The orchestrator merges all staging records into the main memory store at run completion. No conflict resolution or human review — last write wins.

**SH-04.** ShipAgent notifies the originating trigger source. For Slack triggers: post a reply in the original thread with a link to the PR(s) and a summary of what was done.

**SH-05.** The Ship phase has no gate. Operational failures (GitHub API errors, network issues) are handled by retry logic and logged. They are not gates.

**SH-06.** The ShipConnector interface must be documented and extensible. Anticipated extensions: npm publish, container image push, documentation deployment, email notification.

---

## 7. Clarification Gate Protocol

The gate protocol is the defining primitive of the system. All three gates share identical semantics and must be implemented symmetrically.

### Gate Condition

A gate fires when and only when the agent has identified a specific gap in its context that it cannot resolve from available sources, and proceeding without resolving that gap would risk producing incorrect or unsafe output.

A gate does NOT fire because a task seems risky or complex, because the agent wants human approval, because a technical error occurred, or because the agent is uncertain in a general sense. The gate fires only on a specific, articulable, unresolvable context gap.

The gate condition is framework-owned and locked. It is injected as a protected preamble into every agent's system prompt by the AgentDispatcher at instantiation time. It is not visible as an editable field in the UI. Users cannot remove or override it through any configuration surface.

In phases with a multi-agent pipeline, any agent in the pipeline may surface a context gap. That gap is reported to the AgentDispatcher, which escalates it to the GateController. The gate fires at the phase level. The human sees one coherent question, not internal pipeline chatter.

### Gate Mechanics

**GC-01.** When a gate fires, the agent produces a GateEvent containing: gate_id, run_id, phase, fired_at, gap_description, question, agent_state_snapshot.

**GC-02.** The agent_state_snapshot must capture the complete state needed to resume: ContextObject for Gate A, ContextObject plus partial PlanArtifact for Gate P, ContextObject plus PlanArtifact plus ExecutionProgress for Gate E. For multi-agent phase pipelines, the snapshot captures the progress state of every agent in the pipeline and the accumulated canonical artifact at the point of suspension.

**GC-03.** The question delivered to the human must be specific (referencing the exact gap), minimal (asking only what is needed to resolve this gap), and formatted for the delivery channel. In the reference implementation, the question is posted as a reply in the originating Slack thread. No routing to other people in the first version.

**GC-04.** The system enters a WAITING_FOR_HUMAN state. No other processing occurs on this run until a response is received.

**GC-05.** When the human responds, the GateController validates the response, enriches the agent state with the answer, and triggers resume. Resume does not re-run the entire phase from scratch; it continues from the point of suspension with the accumulated artifact intact.

**GC-06.** On resume, the system evaluates whether backward phase traversal is required. Gate A always resumes in Acquire. Gate P always resumes in Plan. Gate E resumes in Execute unless the answer invalidates the PlanArtifact, in which case it resumes in Plan or Acquire if Plan itself requires re-examination.

**GC-07.** Gate timeout: if no human response is received within the configured timeout (default 48 hours), the run enters a STALLED state and the harness re-sends the question. Stalled runs are surfaced prominently in the UI.

**GC-08.** All gate events — fire, response, resume, timeout, re-prompt — are written to the AuditLog.

---

## 8. Agent Architecture

Each TAPES phase is implemented as one or more independent agents. Agents do not share a context window or session. They communicate through canonical phase artifacts passed via the AgentDispatcher.

### Session Ownership and the Master Orchestrator

The Orchestration Core — specifically the combination of RunManager, PhaseRouter, and GateController — is the master orchestrator of every run. It is the single entity that holds authoritative session state for the full lifetime of a run, from the moment the TaskDescriptor is created to the moment the run is marked COMPLETED or FAILED.

Agents are stateless workers. They receive an input artifact, produce an enriched output artifact or a gate event, and terminate. They do not hold session state between invocations. They do not know what phase came before them or what phase comes next. All of that knowledge lives exclusively in the RunManager.

When a gate fires and a run is later resumed, it is the RunManager that reconstructs the correct execution context and the PhaseRouter that determines where to resume. The agent that resumes is a fresh instance given the restored state snapshot.

This separation is fundamental: session continuity is a property of the orchestration core, not of the agents.

### System Prompt Construction

Every agent's system prompt is constructed by the AgentDispatcher as two parts:

The locked preamble (framework-owned, not editable by users) contains: the gate condition, the output artifact schema contract, and the scope constraints for the phase. This preamble is identical in structure across all agents and is prepended to every agent invocation. Users cannot see it as an editable field in the UI.

The editable body (user-owned) contains: domain instructions, tone, thoroughness guidance, skills injection, and rules injection. Users configure this through the harness skill and rule system or directly via the agent configuration UI.

The sensitivity with which an agent assesses context sufficiency — how aggressively it flags gaps — is controlled through the editable body. Users can make an agent more or less thorough through their prompting and skill configuration. But they cannot remove the gate mechanism itself.

### Inter-Agent Runtime and Artifact Handoff

Agents within a phase pipeline communicate through the canonical phase artifact, passed additively. Agent N receives the artifact as built so far, enriches it, and passes it to agent N+1. The artifact type never changes within a phase pipeline. This means any agent built for a phase can be used standalone as the sole agent or as one step in a multi-agent pipeline without modification.

Agents across phases communicate through canonical phase artifacts stored in the RunStore and passed by the PhaseRouter. There is no direct agent-to-agent communication across phases. An agent never calls another agent. The orchestration core mediates all handoffs.

Artifact handoff latency — the time between one agent completing and the next agent receiving its input — must not exceed 2 seconds excluding LLM inference time.

**AM-01.** Each agent has: a configured LLM provider and model, a locked preamble injected by the AgentDispatcher, a user-configurable system prompt body, a tool set, an attached skill list, an attached rule set, and a memory access scope.

**AM-02.** Agents are instantiated per invocation. A new agent instance is created each time an agent is called. Prior work is provided via the accumulated canonical artifact, not via persistent session state.

**AM-03.** Each agent's LLM provider and model is independently configurable. A team may run AcquireAgent on a high-context model, PlanAgent on a reasoning-optimized model, and ExecuteAgent on a code-specialized model. These assignments are set in harness configuration and recorded in the RunStore for each run so the audit log reflects exactly which model made which decision.

**AM-04.** LLM assignments are recorded in the RunStore at run creation time. Switching an agent's LLM assignment takes effect on the next run and does not interrupt runs in progress.

**AM-05.** The AgentDispatcher manages intra-phase agent pipelines: invoking agents in order, passing the accumulated canonical artifact, handling failures within the pipeline, and surfacing gate conditions to the GateController.

**AM-06.** The reference implementation ships with one agent per phase as the default configuration. The pipeline model supports expansion without core changes.

---

## 9. Internal Memory System

The internal memory system is a first-class subsystem. The incremental trust property of TAPES — that gate frequency decreases over time as the agent accumulates domain knowledge — depends entirely on memory being well-designed and reliably queried.

**MEM-01.** The memory system stores embeddings of structured MemoryRecords containing: memory_id, harness_id, created_at, updated_at, type, content, source_run_id, relevance_tags.

**MEM-02.** Memory types include: TaskPattern (how a type of task was previously handled), FileConvention (patterns observed about specific files or modules), TeamConvention (preferences about PR scope, naming, reviewers), GatePattern (which context dimensions triggered gates in past runs and what resolved them), RiskSignal (files or patterns that caused problems in past runs), RepoMap (accumulated knowledge about repository structure and domain ownership).

**MEM-03.** Memory is queried by AcquireAgent at the start of every Acquire phase. The query is semantic (embedding similarity) over the normalized_intent of the TaskDescriptor plus any extracted identifiers such as Jira keys, file paths, and component names.

**MEM-04.** Each run writes to its own memory staging area throughout its lifecycle. At Ship, the orchestrator merges all staging records from the run directly into the main memory store. No conflict detection, no human review. Last write wins. The audit log records what was written and which run wrote it.

**MEM-05.** Memory may be written mid-cycle by AcquireAgent or PlanAgent when a significant discovery is made — for example, an undocumented convention discovered in the codebase or a new repo ownership pattern identified during repo map construction.

**MEM-06.** Memory records from completed runs must be indexed within 5 minutes of run completion so that subsequent runs benefit immediately.

**MEM-07.** The memory system must be queryable from the UI. Operators must be able to browse, search, edit, and delete memory records. Manual memory injection must be supported.

**MEM-08.** The MemoryConnector interface must be abstract and extensible. The reference implementation uses an internal vector store. External providers must be supportable via the interface.

---

## 10. Connector System and Integrations

All external integrations are implemented as connectors against abstract interfaces. The LLM provider is a connector in this system like any other.

### Slack TriggerConnector
Authenticate via Slack App Bot Token and Signing Secret. Subscribe to message events via Events API. Filter by configured channel IDs and trigger prefix. Extract message text, author, channel, timestamp, and thread context. On gate firings, post the clarification question as a reply in the originating thread. On Ship, post PR link(s) and run summary in the originating thread.

### Jira AcquireConnector
Authenticate via Jira API token or OAuth. Extract Jira issue keys from TaskDescriptor. Fetch summary, description, acceptance criteria, issue type, priority, labels, components, sprint, epic, linked issues, subtasks, comments, assignee, and reporter.

### GitHub AcquireConnector
Authenticate via GitHub App or PAT. Fetch repo metadata, file tree, package manifests, and import graphs for paths relevant to the task. Used by AcquireAgent for repo map construction in multi-repo harnesses. Depth of inspection is proportional to relevance.

### GitHub ExecuteConnector
Authenticate via GitHub App or PAT. Clone repository to ephemeral workspace. Create and push feature branch. Apply file edits via structured operations. Run configurable verification commands including arbitrary shell commands and custom scripts. Report verification results per verification_condition.

### GitHub ShipConnector
Open pull request with generated title and body. Assign reviewers per configured team rules or memory-inferred preferences. Add labels per configured label mapping. In multi-repo runs, cross-reference sibling PRs in the PR body. Return PR URL for notification and audit log.

### Internal VectorMemory MemoryConnector
Embed MemoryRecords using a configurable embedding model. Store in local vector database. Expose semantic search query interface. Support full CRUD operations on memory records. Maintain per-run staging area and merge to main store at Ship.

### LLMConnector
The interface through which agents invoke language models. The reference implementation provides Anthropic Claude and OpenAI connectors. Any provider can be added by implementing the interface. Each agent references a named LLMConnector in its configuration. Multiple LLMConnectors can be active simultaneously with different agents using different providers and models.

**LLM-01.** The LLMConnector interface specifies: a completion method accepting messages, system prompt, tools, and model parameters, returning a structured response. It abstracts all provider-specific API details.

**LLM-02.** Each agent's LLM assignment (provider, model, parameters) is set in harness configuration at the agent level.

**LLM-03.** LLM assignments are recorded in the RunStore at run creation time. The audit log for any agent decision includes the LLM provider, model name, and model version that produced it.

**LLM-04.** Switching an agent's LLM assignment takes effect on the next run and does not interrupt runs in progress.

**CON-01.** Each connector category must have a fully documented abstract interface specifying input types, output types, required configuration fields, authentication model, and error contract.

**CON-02.** Connector implementations must be registerable by harness configuration without modifying core orchestration code.

**CON-03.** The product ships with a connector development guide and a minimal example connector for each category.

**CON-04.** Multiple connectors of the same type may be active simultaneously. The orchestration core merges results.

**CON-05.** Connector failures (network errors, auth failures, rate limits) are handled with retry logic and logged. A connector failure is not a gate-firing event; it is an operational error handled separately.

---

## 11. Skills, Rules, and Agent Composition

### Skills

A skill is a structured knowledge module attached to one or more agents providing additional context, conventions, or capabilities relevant to the team's domain.

**SK-01.** A skill is defined as: skill_id, name, description, applicable_phases, content, version.

**SK-02.** Skills are attached at the harness configuration level. All runs under a harness inherit its active skills.

**SK-03.** Skill content is injected into the editable body of the relevant agent's system prompt at instantiation time.

**SK-04.** Skills may include: coding conventions, module ownership maps, glossaries, risk registers, reviewer routing rules, known pitfalls, or any other domain knowledge a human expert would bring to the task.

**SK-05.** Skills are versioned. The skill version active during a run is recorded in the audit log.

### Rules

A rule is a behavioral constraint attached to one or more agents. Unlike skills, rules are imperative and must be followed.

**RU-01.** A rule is defined as: rule_id, name, applicable_phases, constraint, enforcement (hard or soft).

**RU-02.** Hard rules: the agent must comply. If compliance is impossible, the relevant gate fires. The rule's constraint is included in the gate question so the human understands the context.

**RU-03.** Soft rules: the agent should follow but may deviate with documented justification. Any deviation is logged as a rule_deviation event in the AuditLog.

**RU-04.** Example rules: "Never modify files in /migrations without a migration plan subtask in the PlanArtifact," "Always request review from the security team if any file in /auth is modified," "Do not open PRs larger than 400 lines of diff without a documented rationale."

---

## 12. Audit Log and Observability

**AU-01.** The AuditLog records events of the following types: run_created, phase_started, phase_completed, agent_invoked, agent_completed, artifact_handoff, gate_fired, gate_question_sent, gate_answer_received, gate_resumed, gate_traversal_backward, connector_queried, memory_read, memory_written, memory_staged, memory_merged, agent_decision, file_modified, verification_run, verification_result, ship_completed, run_completed, run_failed, rule_deviation, skill_applied, llm_call (provider, model, latency, token counts).

**AU-02.** Every event includes: event_id, run_id, phase, event_type, timestamp, actor (agent_id, llm_provider + model, or "human"), payload.

**AU-03.** The AuditLog is append-only. No event may be modified or deleted after writing. Operators may add annotations to events but not alter them.

**AU-04.** The full reasoning trace for any gate event must be recoverable: what the agent knew, what gap it identified, how it formulated the question, what the human answered, and what the agent did with that answer.

**AU-05.** The UI must provide a per-run audit timeline: a chronological view of all events in a run, filterable by event type and searchable by content.

**AU-06.** The AuditLog must be exportable to JSON and CSV per run.

**AU-07.** Aggregate analytics: gate frequency by phase, gate frequency trend over time (evidence of incremental trust), most common gap dimensions, average time to gate resolution, run completion rate, LLM cost and latency by agent and model.

---

## 13. Resumability and State Management

**RS-01.** Every run has a persisted state object in RunStore. The state object captures the current phase, the current phase's progress including intra-phase pipeline position, the accumulated canonical artifact at each pipeline step, all produced phase artifacts to date, and all gate events.

**RS-02.** When a gate fires, the full agent state is serialized in full and stored as part of the GateEvent. For multi-agent phase pipelines, the serialization captures the accumulated canonical artifact at the point of suspension and the progress of every agent in the pipeline.

**RS-03.** On gate resolution, the system restores the agent state from the GateEvent snapshot, injects the human's answer into the appropriate artifact field, and resumes from the point of suspension with the accumulated artifact intact.

**RS-04.** Backward phase traversal is initiated by the GateController, not by the agent. When the GateController determines that a resolution requires revisiting a prior phase, it constructs the appropriate input artifact for that phase carrying all prior work forward and re-enters that phase.

**RS-05.** A run can exist in the following states: RUNNING, WAITING_FOR_HUMAN, STALLED, COMPLETED, FAILED. State transitions and their conditions are fully specified and enforced by the orchestration core.

**RS-06.** Failed runs must capture the full error context and the last stable state so that a human can diagnose and potentially restart from the last stable phase.

---

## 14. User Interface Requirements

The UI serves operators configuring and monitoring the harness. The primary users are the engineering team deploying and running TAPES cycles using Finch.

**UI-01.** Dashboard: shows all active runs with current phase, time in current phase, and WAITING_FOR_HUMAN indicator. Stalled and failed runs are prominently surfaced.

**UI-02.** Run detail view: shows the full run timeline (audit log events), current phase state, all produced artifacts, active gate state if waiting, and gate history. All artifacts (TaskDescriptor, ContextObject, PlanArtifact, VerificationReport) are readable here but not editable.

**UI-03.** Gate response interface: when a run is WAITING_FOR_HUMAN, the UI surfaces the gate question, the relevant context that led to it, and an input field for the human response.

**UI-04.** Stop execution control: humans may stop a run from the UI at any point. A stopped run enters FAILED state with a human_stopped reason recorded in the audit log.

**UI-05.** Connector configuration: per-harness connector management. Add, configure, test, enable and disable connectors. Credentials stored encrypted. Connector health status visible. Repository registration for multi-repo harnesses.

**UI-06.** Memory browser: searchable, browsable view of all MemoryRecords for a harness. Supports creating, editing, and deleting records manually. Shows which run produced each record.

**UI-07.** Skill and rule management: create, version, activate, and deactivate skills and rules per harness.

**UI-08.** Agent configuration: per-harness, per-phase agent pipeline configuration. Users can add agents to a phase pipeline and configure the editable body of each agent's system prompt. The locked preamble is shown as read-only with a clear label explaining it is framework-owned.

**UI-09.** LLM configuration: per-agent LLM provider and model selection. Shows available registered LLMConnectors. Displays current assignment for each agent. Changes take effect on next run.

**UI-10.** Analytics: gate frequency by phase over time, run completion rate, average cycle time per phase, connector usage and error rates, LLM cost and latency by agent.

**UI-11.** All views update in real time as runs progress via WebSocket-based push updates.

---

## 15. Non-Functional Requirements

**Performance:** Gate questions must be delivered to the trigger channel within 10 seconds of the gate firing. Phase transitions excluding LLM inference time must complete within 2 seconds. Artifact handoff between agents must complete within 2 seconds excluding LLM inference. Memory query results must be returned within 500ms for a harness with up to 10,000 memory records.

**Reliability:** Run state is persisted durably before any external call. Losing the server mid-phase must not lose run state. The system must recover automatically from connector failures using exponential backoff. Gate state must survive application restarts.

**Security:** All connector credentials are stored encrypted at rest. The web UI requires authentication. Multi-tenant isolation: users can only access harnesses they are authorized for. Audit logs may not be modified or deleted by any user role. The locked agent preamble cannot be accessed or modified through any API or UI surface.

**Scalability:** The initial version must support up to 50 concurrent runs per harness. The memory store must support up to 100,000 records per harness without degrading query performance.

**Extensibility:** Adding a new connector (including a new LLM provider) must not require modifying any file in the orchestration core. Adding new agent behavior via skills and rules must not require a code deployment. Adding an agent to a phase pipeline must be achievable through configuration alone.

---

## 16. Reference Implementation Scope

The reference implementation delivered in the initial release covers:

- Full TAPES lifecycle orchestration engine including AgentDispatcher with additive canonical artifact passing for multi-agent phase pipelines
- All five default agents (Trigger, Acquire, Plan, Execute, Ship)
- Locked preamble injection system
- Slack TriggerConnector
- Jira AcquireConnector
- GitHub AcquireConnector (for repo map construction)
- GitHub ExecuteConnector
- GitHub PR ShipConnector (with multi-repo parallel fan-out)
- Internal VectorMemory MemoryConnector with per-run staging and merge-at-Ship
- Webhook TriggerConnector
- Anthropic Claude LLMConnector
- OpenAI LLMConnector
- Multi-repository execution (repo map, sub-task repo assignment, parallel ShipAgents)
- Full audit log
- Run state management and resumability
- Backward phase traversal
- Skills and rules attachment
- Per-agent LLM configuration
- Web UI: dashboard, run detail, gate response, stop execution, connector config, agent pipeline config, LLM config, memory browser, analytics

---

## 17. Extensibility Model

The extensibility model is organized around four surfaces.

**Connectors** — abstract interfaces for all external integrations including LLM providers. Teams implement the interface, register in harness config, and participate in the pipeline without any core modification.

**Skills** — structured text modules injected into the editable body of agent prompts at configuration time. No code required.

**Rules** — behavioral constraints attached to agents. Hard rules enforce constraints; soft rules guide behavior. No code required.

**Agent pipelines** — users add agents to any phase layer through configuration. All agents in a pipeline speak the same canonical artifact language. No core modification required.

A future extensibility surface planned for a subsequent version is full custom phase replacement — the ability to replace an entire built-in phase with a custom implementation for teams with highly specialized logic.

---

## 18. Delivery Milestones

**Milestone 1 — Core Orchestration Engine**
RunManager, PhaseRouter, GateController, AgentDispatcher, AuditLogger. All five agent stubs with no LLM, accepting and returning mock artifacts. Run state persistence. Gate fire, suspend, and resume mechanics. Backward traversal logic. Additive canonical artifact passing in AgentDispatcher. Locked preamble injection scaffold.

**Milestone 2 — Reference Agents and LLM Layer**
LLMConnector interface. Anthropic Claude and OpenAI reference connectors. All five agents implemented with full system prompts and locked preambles. ContextObject, PlanArtifact, and VerificationReport schemas implemented. Self-assessment logic in AcquireAgent. Plan-bounded scope enforcement in ExecuteAgent. Per-agent LLM assignment in configuration.

**Milestone 3 — Reference Connectors**
Slack TriggerConnector, Jira AcquireConnector, GitHub AcquireConnector, GitHub ExecuteConnector, GitHub PR ShipConnector, Internal VectorMemory with staging and merge logic.

**Milestone 4 — Multi-Repository Support**
Repo registration in harness config. Repo map construction in AcquireAgent. Repo assignment on PlanArtifact sub-tasks. Multi-connector Execute. Parallel ShipAgent fan-out.

**Milestone 5 — Memory System**
MemoryRecord schema and embedding pipeline. Semantic query interface. Mid-cycle memory writes. Per-run staging area. Merge at Ship. Memory browser in UI.

**Milestone 6 — Web UI and Observability**
Dashboard, run detail view, gate response UI, stop execution control, connector config UI, agent pipeline config UI, LLM config UI, memory browser, analytics.

**Milestone 7 — Skills, Rules, and Extensibility**
Skill and rule attachment system. Connector extension guide and example template. Agent pipeline extension guide. Public connector and LLMConnector interface documentation.

---

## 19. Open Questions

**OQ-01.** Product name. The product name is TBD and must be resolved before public release documentation is finalized.

**OQ-09.** Memory retention policy. How long are memory records retained? Do they expire? Can older records be archived? What controls exist for compliance-sensitive teams? Not in first version — left open for future planning.

---

*End of Document*

*Version 0.3 — All brainstormed questions resolved except OQ-01 (product name) and OQ-09 (memory retention, deferred). Ready for technical architecture design.*