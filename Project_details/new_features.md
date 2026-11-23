# Nexus Platform — New Features and Implementation Progress

**Project:** Nexus — AI-Augmented Project Management Platform  
**Purpose:** Detailed record of the improvements implemented after the previous semester presentation.

---

## 1. Executive Summary

The previous version of Nexus established the core AI project-management platform:

- Kanban task management
- AI chat with project context
- Roadmap generation
- LangGraph-based Architect Agent
- GitHub repository indexing
- GitHub webhook automation
- Realtime task synchronization
- Analytics and AI narratives
- Team invitations and role-based access

The new implementation advances Nexus from an AI-enabled MVP toward a more reliable and production-oriented project intelligence platform.

The main advancements are:

1. Dependency-aware task planning and critical-path analysis
2. Architect-generated task dependencies
3. Project authorization hardening
4. Webhook replay protection and event auditability
5. Durable indexing-job tracking and retry support
6. Confidence-based commit-to-task matching
7. Human approval for uncertain AI matches
8. AI evaluation data collection and dashboard reporting
9. Automated regression tests for critical utilities
10. Improved operational visibility for GitHub indexing

The new direction is:

> Nexus does not only generate and synchronize project work. It now models dependencies, identifies priority chains, controls uncertain AI decisions, records operational events, and collects evidence about AI quality.

---

## 2. What Was Implemented Previously

### 2.1 Project and task management

The original platform provided:

- Project creation and dashboard management
- A Kanban board with `backlog`, `todo`, `in_progress`, and `done` statuses
- Task creation, editing, deletion, assignment, and status movement
- Optimistic Kanban updates with rollback on failure
- Task activity history through `task_events`
- Supabase Realtime synchronization for task changes

Tasks were stored in PostgreSQL through Drizzle ORM.

### 2.2 AI chat

The original chat workflow:

1. Authenticate the user.
2. Verify project membership.
3. Consume a database-backed rate-limit window.
4. Load recent chat history.
5. Load the complete project board snapshot.
6. Retrieve relevant roadmap sections from Qdrant.
7. Retrieve relevant GitHub code chunks from Qdrant.
8. Send the assembled context to the configured AI provider.
9. Save the user and assistant messages.
10. Save latency, token usage, provider, model, and retry telemetry.

### 2.3 Roadmap generation

The project supported AI-generated implementation plans containing:

- Overview
- Phases
- Goals
- Tasks
- Deliverables

Plans were parsed into structured sections and stored in `implementation_plans`. Plans also had version history, inline section editing, and vector synchronization for roadmap retrieval.

Important behavior: roadmap generation created an implementation plan, but it did not automatically create Kanban task rows.

### 2.4 Architect Agent

The Architect Agent used a LangGraph workflow:

```text
Planner → Critic → Finalizer
              ↓
         Revision loop
```

The Planner decomposed requirements into tasks. The Critic reviewed missing tasks, priorities, dependencies, security, and testing. If revision was required, the graph could return to the Planner. The Finalizer produced the final task list.

The output was validated with Zod before persistence.

### 2.5 Shared RAG memory

Qdrant stored three semantic collections:

- `tasks`
- `roadmap`
- `code_chunks`

Gemini embeddings were used with a default vector dimension of 768. Payload metadata enabled project-scoped retrieval and filtering.

### 2.6 GitHub integration

The original GitHub integration supported:

- OAuth repository connection
- Repository selection
- Full repository indexing
- File filtering
- 150-line chunks with 20-line overlap
- Gemini embeddings for code chunks
- Qdrant code retrieval
- Push webhook handling
- Changed-file reindexing
- Commit-to-task matching
- Automatic task completion

### 2.7 Analytics and collaboration

The original platform also included:

- Completion and status metrics
- Priority distribution
- Member performance
- Burndown reconstruction from task events
- AI-generated PM narratives
- Team invitations with expiry
- Owner/admin/member roles
- SMTP/Nodemailer invitation delivery

---

# 3. New Feature: Task Dependencies

## 3.1 Motivation

A Kanban status alone does not explain why a task cannot start. A task may be blocked by another task, a database migration, an API contract, or a foundational setup step.

The new dependency system models these relationships explicitly.

Example:

```text
Implement dashboard UI
        depends on
Create analytics API
        depends on
Design analytics schema
```

This allows the system to identify which tasks must be completed first.

## 3.2 Database design

A new `task_dependencies` table stores directed edges:

```text
project_id
 task_id             → the dependent task
 depends_on_task_id  → the blocking task
 created_by
 created_at
```

The table includes:

- Foreign keys to both task records
- Foreign key to the project
- Cascade deletion when a task or project is deleted
- A unique index preventing duplicate edges
- A project index for efficient graph loading

The relationship is interpreted as:

```text
task_id cannot start until depends_on_task_id is complete
```

## 3.3 Validation rules

The server rejects:

- A task depending on itself
- Dependencies across different projects
- Edges that create a cycle

Cycle example:

```text
A depends on B
B depends on C
C depends on A   ← rejected
```

Cycle detection traverses the existing dependency graph before inserting a new edge.

## 3.4 Manual dependency workflow

Users can open a task modal and:

1. Select another task as a blocker.
2. Add the dependency.
3. View all current blockers.
4. Remove a blocker.
5. Receive validation feedback if the edge would create a cycle.

After a dependency is created or removed, the board graph refreshes automatically.

## 3.5 Why it improves the old system

Previously, task order existed only in:

- Kanban status
- Creation order
- AI-generated task ordering

Now, task order is represented as explicit data. This supports reliable planning, dependency validation, critical-path calculation, and future scheduling features.

---

# 4. New Feature: Visual Dependency Graph

## 4.1 Graph panel

The Kanban board now includes a dependency graph panel. It displays related tasks in dependency levels:

```text
Starting work → After level 1 → After level 2 → After level 3
```

Each node displays:

- Task title
- Current status
- Story points

The panel supports:

- Show/hide behavior
- Refresh after dependency changes
- Horizontal scrolling for large graphs
- Critical-path highlighting

## 4.2 Critical-path visualization

Tasks that belong to the highest-impact unfinished chain are visually highlighted. This helps a project manager answer:

> Which sequence of tasks should the team prioritize to unblock the most important work?

## 4.3 Current scope and future improvement

The current graph is a functional level-based visualization. A future enhancement could add:

- Zoom and pan
- Dragged node positioning
- React Flow or another graph library
- Filtering by phase, assignee, or priority
- Direct edge creation from the graph
- Dependency bottleneck highlighting

---

# 5. New Feature: Critical-Path Calculation

## 5.1 Algorithm

The critical path is calculated as the highest-weight unfinished dependency chain.

Each task receives a weight:

```text
weight = story points
```

If story points are absent, the task receives a default weight of 1.

For every task, the algorithm recursively calculates:

```text
current task weight + highest-weight blocker path
```

The path with the greatest total score becomes the project critical path.

## 5.2 Example

```text
Task A = 3 points
Task B = 5 points, depends on A
Task C = 8 points, depends on B
```

Critical path:

```text
A → B → C
Total = 16 story points
```

Completed tasks are excluded from the final unfinished critical-path candidates.

## 5.3 Why it matters

The previous board showed task status but could not reason about dependency-driven priority. The new algorithm provides a concrete prioritization signal based on:

- Task relationships
- Remaining work
- Story-point estimates

## 5.4 Testing

The pure graph algorithms are tested for:

- Cycle detection
- Longest unfinished path calculation
- Story-point aggregation

---

# 6. New Feature: Architect-Generated Dependencies

## 6.1 Problem

Generated tasks do not have database IDs until they are accepted. Therefore, the AI cannot refer to future UUIDs directly.

## 6.2 Solution

The Architect Agent returns zero-based dependency indices:

```json
{
  "title": "Implement analytics API",
  "dependsOnTaskIndices": [0]
}
```

This means the task depends on the first task in the generated list.

## 6.3 Safety handling

The system sanitizes generated dependency references by:

- Removing duplicate indices
- Removing negative indices
- Removing references to the current or later task
- Allowing only references to earlier generated tasks

When the user accepts generated tasks:

1. All selected tasks receive database IDs.
2. The original generation indices are preserved.
3. Dependency indices are translated to actual task IDs.
4. Valid dependency edges are inserted.
5. Partial selection is handled safely.

If a selected task refers to a task that was not selected, that edge is skipped instead of pointing to an invalid task.

## 6.4 Improvement over the previous Architect Agent

Previously, the agent generated a flat task list. Now, it generates a structured task plan with:

- Ordering
- Dependencies
- Story points
- Priorities
- Tags
- Acceptance criteria

This makes generated work more executable.

---

# 7. New Feature: Authorization Hardening

## 7.1 Previous limitation

Several project-scoped actions authenticated the user but did not verify membership in the requested project.

The known gaps included:

- Roadmap actions
- Insight actions
- GitHub actions
- Task event history

## 7.2 Improvement

The existing permission helper is now applied consistently:

```text
getMembership(userId, projectId)
        ↓
hasRole(actualRole, minimumRole)
        ↓
requireRole(userId, projectId, minimumRole)
```

## 7.3 Current access rules

- Members can read project data and perform normal task operations.
- Admins can manage GitHub connections and indexing.
- Owners retain project-level destructive privileges.
- Task event history now resolves the task’s project before returning events.

## 7.4 Impact

A signed-in user can no longer access these project actions merely by knowing a project ID. The action must also confirm membership and the required role.

---

# 8. New Feature: Webhook Replay Protection

## 8.1 Previous behavior

The GitHub webhook verified HMAC signatures and processed push events, but duplicate deliveries were not persistently tracked.

GitHub can retry webhook delivery, so the same push could potentially trigger duplicate processing.

## 8.2 New event table

The `github_webhook_events` table stores:

- GitHub delivery ID
- Project ID
- Repository
- Event type
- Commit SHA
- Processing status
- Error message
- Received timestamp
- Processed timestamp

## 8.3 New workflow

```text
Receive webhook
      ↓
Verify HMAC signature
      ↓
Read X-GitHub-Delivery
      ↓
Insert delivery record
      ↓
Already exists? Return duplicate success
      ↓
Schedule processing
      ↓
Mark completed or failed
```

## 8.4 Why this improves the old system

The old flow protected authenticity but not replay behavior. The new flow adds:

- Duplicate detection
- Processing auditability
- Failure visibility
- A basis for future replay/retry tooling

---

# 9. New Feature: Durable Indexing Jobs

## 9.1 Previous behavior

Repository indexing was executed through the request/deferred processing flow and errors were mainly visible in logs.

## 9.2 New indexing job model

The `indexing_jobs` table records:

- Project ID
- Job type
- Status
- Commit SHA
- Total files
- Processed files
- Failed files
- Error message
- Start time
- Completion time
- Creation time

Supported statuses:

```text
queued
running
completed
failed
```

## 9.3 Covered workflows

Indexing jobs are created for:

- GitHub push reindexing
- Manual full repository reindexing

## 9.4 Retry support

Failed manual indexing jobs can now be retried from GitHub project settings.

The retry flow:

1. Verify that the job exists.
2. Verify the user has admin access.
3. Reset the job to `running`.
4. Re-run repository indexing.
5. Store successful or failed results.

## 9.5 Operational UI

GitHub settings now displays:

- Indexing job type
- Status
- Processed files
- Total files
- Retry action for failed jobs

This replaces a log-only workflow with visible operational state.

---

# 10. New Feature: Confidence-Based Commit Matching

## 10.1 Previous behavior

The commit matcher returned only task IDs:

```json
{
  "taskIds": ["task-1"]
}
```

Valid IDs were checked against open tasks, but there was no confidence score or human explanation.

## 10.2 New response contract

The matcher now expects:

```json
{
  "matches": [
    {
      "taskId": "task-1",
      "confidence": 0.94,
      "reason": "The commit implements the OAuth callback described by the task."
    }
  ]
}
```

The server validates:

- Task ID type
- Task ID membership in the current open-task set
- Confidence type
- Confidence range
- Reason length

Confidence is clamped between 0 and 1.

## 10.3 Decision policy

```text
confidence >= 0.90  → auto-close task
confidence < 0.90   → create pending review match
```

Pending matches are not allowed to change task status automatically.

## 10.4 Human approval workflow

Admins can:

- View commit SHA
- View matched task title
- View confidence percentage
- View the AI reason
- Approve the match
- Reject the match

Approval changes the task to `done`. Rejection preserves the task’s current state.

## 10.5 Improvement over the old system

This changes automation from a binary AI decision into a risk-aware workflow:

```text
High confidence → automation
Uncertain result → human review
Invalid result → ignored
```

This reduces incorrect automatic task closure.

---

# 11. New Feature: AI Evaluation Records

## 11.1 Motivation

The previous presentation discussed measurable AI goals, but the application did not store structured evaluation records.

The new system records evidence about AI behavior.

## 11.2 Evaluation schema

The `ai_evaluations` table stores:

- Project ID
- Feature type
- Source ID
- Input text
- Expected output
- Actual output
- Grounding score
- Relevance score
- Human acceptance value
- Latency
- Model
- Notes
- Timestamp

## 11.3 Automatic sample capture

Evaluation samples are automatically created for:

- Chat completions
- Architect Agent generations
- Commit matcher responses

Captured metadata includes:

- Input
- Output
- Provider/model
- Latency
- Feature type

Quality scores can later be labelled by a human evaluator.

## 11.4 Insights evaluation panel

The Insights page now shows:

- Number of evaluation samples
- Average grounding score
- Average relevance score
- Accepted versus labelled evaluations

If no samples exist, the panel explicitly reports that evaluation data has not been recorded yet.

## 11.5 Important honesty point

The system now collects evaluation data, but it does not automatically prove zero hallucination or perfect accuracy. Human labels, expected outputs, or a benchmark dataset are still needed to calculate reliable quality metrics.

---

# 12. New Feature: Automated Tests

## 12.1 Previous state

The repository previously had no committed automated tests.

## 12.2 New test setup

Vitest was added as the test runner with an `npm test` command.

## 12.3 Current tests

The suite covers:

- Dependency cycle detection
- Critical-path calculation
- Webhook HMAC signature verification
- Code chunking and overlap
- File filtering rules

Current validation result:

```text
4 test files passed
7 tests passed
```

## 12.4 Why this improves the project

These tests cover high-risk pure logic without requiring live external services. They provide regression protection for:

- Security verification
- Indexing behavior
- Dependency planning
- Critical-path prioritization

---

# 12A. New Infrastructure: BullMQ GitHub Processing Queue

## 12A.1 Why a queue was added

The earlier webhook and reindex implementation used Next.js deferred work. That was useful for development but did not provide durable queue state or automatic retry for failures.

The new implementation uses BullMQ with Redis.

## 12A.2 Queue architecture

```text
GitHub or Settings UI
          ↓
Create indexing_jobs record
          ↓
Enqueue typed BullMQ job
          ↓
Redis
          ↓
Separate GitHub worker process
          ↓
GitHub API / Qdrant / PostgreSQL
```

## 12A.3 Supported jobs

- `github-push`: process a GitHub push delivery
- `github-full-index`: perform a complete repository index

Both job types reference the same `indexing_jobs` row, allowing the database and UI to show queue progress.

## 12A.4 Retry policy

BullMQ is configured with:

- 3 attempts
- Exponential backoff starting at 5 seconds
- 100 completed jobs retained
- 200 failed jobs retained
- 2 concurrent worker operations

## 12A.5 Worker behavior

The worker:

1. Marks the indexing job as `running`.
2. Processes changed, added, or removed files.
3. Reindexes code chunks in Qdrant.
4. Runs commit-to-task matching.
5. Persists auto-close or pending-match decisions.
6. Marks the indexing job and webhook delivery as completed or failed.

## 12A.6 Runtime setup

The queue worker starts with:

```bash
npm run queue:worker
```

The combined development startup also attempts to start the worker:

```bash
npm run start:all
```

Redis is selected with:

```dotenv
REDIS_URL=redis://127.0.0.1:6379
```

The URL can be replaced with a hosted Redis or Upstash-compatible Redis URL.

## 12A.7 Verification and operations

Redis and BullMQ are usable in four verification layers:

### Connection verification

Use a short script or the combined startup preflight to confirm that `REDIS_URL` accepts a TLS connection and returns `PONG`:

```bash
npx tsx -e "import IORedis from 'ioredis'; import 'dotenv/config'; const r=new IORedis(process.env.REDIS_URL!,{maxRetriesPerRequest:1,connectTimeout:10000}); r.ping().then(v=>{console.log(v);r.quit()}).catch(e=>{console.error(e.message);process.exit(1)})"
```

Expected result:

```text
PONG
```

### Queue smoke verification

Create a temporary BullMQ job and confirm that BullMQ can serialize and write it to Redis:

```bash
npx tsx -e "import 'dotenv/config'; import { Queue } from 'bullmq'; import IORedis from 'ioredis'; const c=new IORedis(process.env.REDIS_URL!); const q=new Queue('nexus-smoke-test',{connection:c}); q.add('ping',{ok:true},{removeOnComplete:true}).then(j=>console.log('Queued job:',j.id)).finally(async()=>{await q.close();await c.quit()})"
```

### Worker verification

Start the worker in a separate terminal:

```bash
npm run queue:worker
```

A successful worker reports:

```text
[github-worker] Ready
```

The worker logs completed and failed jobs:

```text
[github-worker] Completed <job-id>
[github-worker] Failed <job-id>: <error>
```

### End-to-end verification

To verify the complete queue:

1. Start Redis through the configured hosted provider.
2. Start the GitHub worker.
3. Start the Next.js application.
4. Connect or reindex a GitHub repository.
5. Confirm a row appears in `indexing_jobs` with `queued` status.
6. Watch the worker log as the status becomes `running` and then `completed` or `failed`.
7. Trigger the same GitHub delivery again and confirm webhook replay protection prevents duplicate processing.

BullMQ automatically retries failed queue jobs with exponential backoff. The database record remains the presentation-facing and audit-facing source of truth for final progress.

## 12A.8 Implementation locations

- Redis URL and shared IORedis connection: `src/core/queue/redis.ts`
- BullMQ queue and typed job definitions: `src/modules/github/queue.ts`
- GitHub push enqueue: `src/app/api/webhooks/github/route.ts`
- Manual reindex and retry enqueue: `src/modules/github/actions.ts`
- Worker processor: `scripts/github-worker.ts`
- Worker package script: `package.json`
- Redis startup preflight: `scripts/start-all.mjs`
- Queue environment setting: `.env`
- Optional local Redis Compose setup: `compose.redis.yml`

## 12A.9 Presentation benefit

This advancement separates short-lived HTTP requests from long-running repository work. GitHub webhooks now return immediately after queue insertion, while a worker provides durable retries and processing isolation.

# 12B. Redis Chat Request Queue

## 12B.1 Previous behavior

Chat responses were generated synchronously inside the Next.js server-action request.

This caused the browser request to remain open until:

- RAG context was assembled
- The provider returned a completion
- Tool/model retries finished
- PostgreSQL telemetry was saved

## 12B.2 New behavior

Chat now uses the `ai-processing` BullMQ queue.

```text
User sends message
      ↓
Save user message in PostgreSQL
      ↓
Apply Redis user/project rate limit
      ↓
Assemble board + roadmap + code context
      ↓
Enqueue typed chat job
      ↓
Return queued placeholder immediately
      ↓
AI worker performs completion
      ↓
Worker saves assistant message + metrics
      ↓
Client polls job status
      ↓
Client reloads persisted chat history
```

## 12B.3 Job data

The chat job contains:

- Project ID
- User ID
- User message
- Recent conversation history
- System prompt with board/Roadmap/GitHub context
- Unique job ID

## 12B.4 Reliability

The chat queue uses:

- 3 attempts
- Exponential backoff
- 100 completed jobs retained
- 200 failed jobs retained
- 2 worker concurrent operations

The chat worker saves success/failure output to PostgreSQL rather than keeping the response only in Redis.

## 12B.5 Redis rate limiting

Chat requests use an atomic fixed-window Lua/Redis `INCR` operation keyed by:

```text
nexus:chat-rate:<userId>:<projectId>
```

This prevents concurrent chat submissions from bypassing the chat limit. Redis returns:

- Allowed state
- Remaining requests
- Retry-after TTL

# 12C. Redis Architect Task-Generation Queue

## 12C.1 Previous behavior

Architect generation ran synchronously through the server action while the LangGraph Planner/Critic/Finalizer graph called the AI provider.

## 12C.2 New behavior

Architect generation now uses the same `ai-processing` queue:

```text
User submits requirement
      ↓
Check Architect Redis limit
      ↓
Retrieve roadmap + existing tasks + code context
      ↓
Enqueue Architect job
      ↓
Return queued status immediately
      ↓
AI worker runs LangGraph
      ↓
Zod validates final JSON
      ↓
Worker saves agent_generations
      ↓
Worker returns result through BullMQ
      ↓
UI polls and displays generated tasks
```

## 12C.3 Architect limits

Architect generation is limited independently by:

```text
nexus:architect-rate:<userId>:<projectId>
```

This protects the provider and prevents repeated expensive graph runs.

# 12D. Redis AI-Provider Rate Limiting

A provider-wide Redis fixed-window limit protects all OpenAI-compatible chat completion calls:

```text
nexus:ai-provider:<provider>
```

This applies to:

- Chat completions
- Commit matching
- AI insights
- Architect LangGraph calls
- Other chat-completion utility calls

This is separate from the chat and Architect limits:

| Limit | Scope |
|---|---|
| Chat limit | User + project |
| Architect limit | User + project |
| Provider limit | Provider-wide |

# 12E. Queue Worker Verification

Redis and both workers can be verified through separate terminals:

```bash
npm run queue:worker
npm run ai:worker
npm run dev
```

Or combined:

```bash
npm run start:all
```

Successful worker output:

```text
[github-worker] Ready
[ai-worker] Ready
```

A chat or Architect job is working when:

- BullMQ reports the job as `completed` or `failed`
- PostgreSQL contains the assistant message or agent generation
- The UI replaces queued status with persisted results
- Worker logs show completion or retry information

# 13. Database Evolution

The original project had 13 relational tables. The current schema includes additional tables for the new features:

- `task_dependencies`
- `github_webhook_events`
- `indexing_jobs`
- `github_task_matches`
- `ai_evaluations`

The latest schema contains 18 relational tables.

Migration files were generated for the new tables. The database migration command has now successfully reached the configured PostgreSQL database; the notices about the existing `drizzle` schema and `__drizzle_migrations` table are normal PostgreSQL notices.

The migration command is:

```bash
npm run db:migrate
```

---

# 14. End-to-End New Workflow

```text
User creates project
        ↓
AI generates roadmap
        ↓
Architect Agent receives complete active roadmap
        ↓
Planner generates ordered tasks and dependencies
        ↓
Critic checks completeness and risks
        ↓
Finalizer emits validated structured tasks
        ↓
User accepts tasks
        ↓
Tasks and dependency edges are persisted
        ↓
Kanban displays board and dependency graph
        ↓
Critical path highlights priority chain
        ↓
GitHub push arrives
        ↓
Webhook delivery is verified and deduplicated
        ↓
Indexing job processes changed files
        ↓
Commit matcher produces confidence-scored matches
        ↓
High-confidence tasks auto-close
        ↓
Uncertain matches enter admin review
        ↓
AI outputs and latency are recorded for evaluation
```

---

# 15. Current Limitations and Honest Status

The project is substantially more complete, but these points should be stated accurately:

- The dependency graph is functional but currently a level-based visualization rather than a full drag-and-drop graph editor.
- BullMQ queue monitoring could be enhanced with Bull Board or a dedicated operations dashboard.
- AI evaluation samples are captured automatically, but reliable scores still require human labels or a benchmark dataset.
- GitHub access-token encryption at rest is not yet implemented.
- The build configuration still skips TypeScript and ESLint validation during Next.js production builds, although separate validation commands pass.
- External services remain required for full runtime behavior: PostgreSQL/Supabase, Qdrant, Redis/Upstash, AI provider credentials, and optional GitHub OAuth.

The strongest claim is:

> Nexus has progressed from a feature-rich AI project-management MVP to a dependency-aware, authorization-hardened, replay-aware, observable, and evaluation-ready project intelligence platform.
