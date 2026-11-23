import { Queue } from 'bullmq';
import { createQueueJobId, getRedisConnection } from '@/core/queue/redis';

export const GITHUB_QUEUE_NAME = 'github-indexing';

export type GitHubPushJobData = {
  kind: 'push';
  projectId: string;
  indexingJobId: string;
  deliveryId: string;
  commits: Array<{
    id: string;
    message: string;
    added?: string[];
    modified?: string[];
    removed?: string[];
  }>;
  ownerUserId: string;
};

export type GitHubFullIndexJobData = {
  kind: 'full-index';
  projectId: string;
  indexingJobId: string;
};

export type GitHubQueueJobData = GitHubPushJobData | GitHubFullIndexJobData;

const globalForQueue = globalThis as unknown as {
  nexusGitHubQueue?: Queue<GitHubQueueJobData>;
};

export function getGitHubQueue(): Queue<GitHubQueueJobData> {
  if (!globalForQueue.nexusGitHubQueue) {
    globalForQueue.nexusGitHubQueue = new Queue<GitHubQueueJobData>(GITHUB_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return globalForQueue.nexusGitHubQueue;
}

export async function enqueueGitHubPush(data: GitHubPushJobData) {
  return getGitHubQueue().add('github-push', data, {
    jobId: createQueueJobId('push', data.deliveryId),
  });
}

export async function enqueueFullGitHubIndex(data: GitHubFullIndexJobData) {
  return getGitHubQueue().add('github-full-index', data, {
    jobId: createQueueJobId('full', data.indexingJobId),
  });
}
