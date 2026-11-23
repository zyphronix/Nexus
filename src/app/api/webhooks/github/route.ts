import { NextResponse } from 'next/server';
import { db } from '@/core/db/client';
import { githubConnections, githubWebhookEvents } from '@/core/db/schema';
import { eq } from 'drizzle-orm';
import { verifyWebhookSignature } from '@/modules/github/lib/webhook-verify';
import { createIndexingJob, updateIndexingJob } from '@/core/db/queries';
import { enqueueGitHubPush } from '@/modules/github/queue';

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

  try {
    await enqueueGitHubPush({
      kind: 'push',
      projectId,
      indexingJobId: indexingJob.id,
      deliveryId,
      commits,
      ownerUserId,
    });
  } catch (error) {
    await updateIndexingJob(indexingJob.id, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Failed to queue webhook job',
      completedAt: new Date(),
    });
    await db
      .update(githubWebhookEvents)
      .set({
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Failed to queue webhook job',
        processedAt: new Date(),
      })
      .where(eq(githubWebhookEvents.deliveryId, deliveryId));

    return NextResponse.json({ error: 'Queue unavailable' }, { status: 503 });
  }

  return NextResponse.json({ ok: true, queued: true, commits: commits.length });
}
