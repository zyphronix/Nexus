import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { db } from '@/core/db/client';
import { githubConnections, githubTaskMatches, githubWebhookEvents } from '@/core/db/schema';
import { eq } from 'drizzle-orm';
import { verifyWebhookSignature } from '@/modules/github/lib/webhook-verify';
import { reindexChangedFiles } from '@/modules/github/lib/indexer';
import { matchCommitToTasks } from '@/modules/github/lib/commit-matcher';
import { updateTask } from '@/core/db/queries/tasks';
import { createIndexingJob, updateIndexingJob } from '@/core/db/queries';

type PushCommit = {
  id: string;
  message: string;
  added?: string[];
  modified?: string[];
  removed?: string[];
};

type PushPayload = {
  repository?: { full_name?: string };
  commits?: PushCommit[];
  head_commit?: PushCommit;
};

export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = request.headers.get('x-github-event');
  const deliveryId = request.headers.get('x-github-delivery');
  if (event === 'ping') {
    return NextResponse.json({ ok: true, pong: true });
  }
  if (event !== 'push') {
    return NextResponse.json({ ok: true, ignored: event });
  }

  let payload: PushPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const repoFullName = payload.repository?.full_name;
  if (!repoFullName) {
    return NextResponse.json({ ok: true, ignored: 'no repository' });
  }

  const [conn] = await db
    .select()
    .from(githubConnections)
    .where(eq(githubConnections.repoFullName, repoFullName));

  if (!conn) {
    return NextResponse.json({ ok: true, ignored: 'unknown repo' });
  }

  if (!deliveryId) {
    return NextResponse.json({ error: 'Missing delivery ID' }, { status: 400 });
  }

  const [delivery] = await db
    .insert(githubWebhookEvents)
    .values({
      deliveryId,
      projectId: conn.projectId,
      repository: repoFullName,
      eventType: event,
      commitSha: payload.head_commit?.id ?? null,
      status: 'processing',
    })
    .onConflictDoNothing()
    .returning();

  if (!delivery) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const projectId = conn.projectId;
  const ownerUserId = conn.userId;
  const commits = payload.commits || [];
  const indexingJob = await createIndexingJob({
    projectId,
    jobType: 'github_push',
    commitSha: payload.head_commit?.id,
    totalFiles: commits.reduce(
      (total, commit) =>
        total + (commit.added?.length ?? 0) + (commit.modified?.length ?? 0) + (commit.removed?.length ?? 0),
      0,
    ),
  });

  // Defer heavy work so the webhook responds quickly
  after(async () => {
    let hasFailures = false;
    let processedFiles = 0;
    let failedFiles = 0;
    await updateIndexingJob(indexingJob.id, {
      status: 'running',
      startedAt: new Date(),
    });
    try {
      for (const commit of commits) {
        const changed = [...(commit.added || []), ...(commit.modified || [])];
        const removed = commit.removed || [];

        try {
          await reindexChangedFiles(projectId, changed, removed);
          processedFiles += changed.length + removed.length;
        } catch (err) {
          hasFailures = true;
          failedFiles += changed.length + removed.length;
          console.warn(`[github-webhook] reindex failed for ${commit.id}:`, err);
        }

        try {
          const matched = await matchCommitToTasks({
            projectId,
            commitMessage: commit.message,
            filesChanged: changed,
          });
          for (const match of matched) {
            try {
              if (match.confidence >= 0.9) {
                await updateTask(match.taskId, { status: 'done' }, ownerUserId);
                await db.insert(githubTaskMatches).values({
                  id: crypto.randomUUID(),
                  projectId,
                  commitSha: commit.id,
                  taskId: match.taskId,
                  confidence: Math.round(match.confidence * 100),
                  reason: match.reason,
                  status: 'auto_closed',
                  reviewedAt: new Date(),
                });
                console.info(
                  `[github-webhook] auto-closed task ${match.taskId} from commit ${commit.id}`
                );
              } else {
                await db.insert(githubTaskMatches).values({
                  id: crypto.randomUUID(),
                  projectId,
                  commitSha: commit.id,
                  taskId: match.taskId,
                  confidence: Math.round(match.confidence * 100),
                  reason: match.reason,
                  status: 'pending',
                });
              }
            } catch (err) {
              hasFailures = true;
              console.warn(`[github-webhook] failed to persist match for ${match.taskId}:`, err);
            }
          }
        } catch (err) {
          hasFailures = true;
          console.warn(`[github-webhook] commit matcher failed for ${commit.id}:`, err);
        }
      }
      await db
        .update(githubWebhookEvents)
        .set({
          status: hasFailures ? 'failed' : 'completed',
          processedAt: new Date(),
        })
        .where(eq(githubWebhookEvents.deliveryId, deliveryId));
      await updateIndexingJob(indexingJob.id, {
        status: hasFailures ? 'failed' : 'completed',
        processedFiles,
        failedFiles,
        completedAt: new Date(),
      });
    } catch (err) {
      await updateIndexingJob(indexingJob.id, {
        status: 'failed',
        processedFiles,
        failedFiles,
        errorMessage: err instanceof Error ? err.message : 'Indexing job failed',
        completedAt: new Date(),
      });
      await db
        .update(githubWebhookEvents)
        .set({
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : 'Webhook processing failed',
          processedAt: new Date(),
        })
        .where(eq(githubWebhookEvents.deliveryId, deliveryId));
    }
  });

  return NextResponse.json({ ok: true, commits: commits.length });
}
