import { Queue } from 'bullmq';
import { createQueueJobId, getRedisConnection } from './redis';

export const AI_QUEUE_NAME = 'ai-processing';

export type ChatAIJobData = {
  kind: 'chat';
  jobId: string;
  projectId: string;
  userId: string;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  systemPrompt: string;
};

export type ArchitectAIJobData = {
  kind: 'architect';
  jobId: string;
  projectId: string;
  userId: string;
  requirement: string;
  projectName?: string;
  projectDescription?: string;
  techStack?: string[];
  architecturalGuidelines?: string;
  existingTasks?: string;
  repoCodeContext?: string;
};

export type AIQueueJobData = ChatAIJobData | ArchitectAIJobData;

const globalForQueue = globalThis as unknown as {
  nexusAIQueue?: Queue<AIQueueJobData>;
};

export function getAIQueue(): Queue<AIQueueJobData> {
  if (!globalForQueue.nexusAIQueue) {
    globalForQueue.nexusAIQueue = new Queue<AIQueueJobData>(AI_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return globalForQueue.nexusAIQueue;
}

export async function enqueueChatJob(data: ChatAIJobData) {
  return getAIQueue().add('chat-completion', data, {
    jobId: createQueueJobId(data.jobId),
  });
}

export async function enqueueArchitectJob(data: ArchitectAIJobData) {
  return getAIQueue().add('architect-generation', data, {
    jobId: createQueueJobId(data.jobId),
  });
}
