import 'dotenv/config';
import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db } from '../src/core/db/client';
import { githubTaskMatches, githubWebhookEvents } from '../src/core/db/schema';
import { getRedisConnection } from '../src/core/queue/redis';
import { GITHUB_QUEUE_NAME, type GitHubQueueJobData } from '../src/modules/github/queue';
import { indexRepo, reindexChangedFiles } from '../src/modules/github/lib/indexer';
import { matchCommitToTasks } from '../src/modules/github/lib/commit-matcher';
import { updateTask } from '../src/core/db/queries/tasks';
import { updateIndexingJob } from '../src/core/db/queries/indexing-jobs';

const worker = new Worker<GitHubQueueJobData>(
  GITHUB_QUEUE_NAME,
  async (job) => {
    const data = job.data;
    await updateIndexingJob(data.indexingJobId, {
      status: 'running',
      startedAt: new Date(),
      errorMessage: null,
      completedAt: null,
    });

    let processedFiles = 0;
    let failedFiles = 0;

    try {
      if (data.kind === 'full-index') {
        const result = await indexRepo(data.projectId);
        await updateIndexingJob(data.indexingJobId, {
          status: 'completed',
          totalFiles: result.filesIndexed + result.filesSkipped,
          processedFiles: result.filesIndexed,
          failedFiles: result.filesSkipped,
          completedAt: new Date(),
        });
        return result;
      }

      let hasFailures = false;
      for (const commit of data.commits) {
        const changed = [...(commit.added ?? []), ...(commit.modified ?? [])];
        const removed = commit.removed ?? [];

        try {
          await reindexChangedFiles(data.projectId, changed, removed);
          processedFiles += changed.length + removed.length;
        } catch (error) {
          hasFailures = true;
          failedFiles += changed.length + removed.length;
          console.error(`[github-worker] Reindex failed for ${commit.id}:`, error);
        }

        try {
          const matches = await matchCommitToTasks({
            projectId: data.projectId,
            commitMessage: commit.message,
            filesChanged: changed,
          });

          for (const match of matches) {
            if (match.confidence >= 0.9) {
              await updateTask(match.taskId, { status: 'done' }, data.ownerUserId);
              await db.insert(githubTaskMatches).values({
                id: crypto.randomUUID(),
                projectId: data.projectId,
                commitSha: commit.id,
                taskId: match.taskId,
                confidence: Math.round(match.confidence * 100),
                reason: match.reason,
                status: 'auto_closed',
                reviewedAt: new Date(),
              });
            } else {
              await db.insert(githubTaskMatches).values({
                id: crypto.randomUUID(),
                projectId: data.projectId,
                commitSha: commit.id,
                taskId: match.taskId,
                confidence: Math.round(match.confidence * 100),
                reason: match.reason,
                status: 'pending',
              });
            }
          }
        } catch (error) {
          hasFailures = true;
          console.error(`[github-worker] Commit matching failed for ${commit.id}:`, error);
        }
      }

      await db
        .update(githubWebhookEvents)
        .set({
          status: hasFailures ? 'failed' : 'completed',
          processedAt: new Date(),
        })
        .where(eq(githubWebhookEvents.deliveryId, data.deliveryId));

      await updateIndexingJob(data.indexingJobId, {
        status: hasFailures ? 'failed' : 'completed',
        processedFiles,
        failedFiles,
        completedAt: new Date(),
      });

      return { processedFiles, failedFiles };
    } catch (error) {
      await updateIndexingJob(data.indexingJobId, {
        status: 'failed',
        processedFiles,
        failedFiles,
        errorMessage: error instanceof Error ? error.message : 'Queue processing failed',
        completedAt: new Date(),
      });

      if (data.kind === 'push') {
        await db
          .update(githubWebhookEvents)
          .set({
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : 'Queue processing failed',
            processedAt: new Date(),
          })
          .where(eq(githubWebhookEvents.deliveryId, data.deliveryId));
      }

      throw error;
    }
  },
  {
    connection: getRedisConnection(),
    concurrency: 2,
  },
);

worker.on('ready', () => console.log('[github-worker] Ready'));
worker.on('completed', (job) => console.log(`[github-worker] Completed ${job.id}`));
worker.on('failed', (job, error) => {
  console.error(`[github-worker] Failed ${job?.id}:`, error.message);
});

async function shutdown() {
  await worker.close();
  await getRedisConnection().quit();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
