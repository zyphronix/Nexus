import 'dotenv/config';
import { Worker } from 'bullmq';
import { getRedisConnection } from '../src/core/queue/redis';
import { AI_QUEUE_NAME, type AIQueueJobData } from '../src/core/queue/ai-queue';
import { generateChatCompletion } from '../src/core/ai/chat';
import { saveChatMessage, createAiEvaluation, saveGeneration } from '../src/core/db/queries';
import { runArchitectGraph } from '../src/modules/architect/graph';

const worker = new Worker<AIQueueJobData>(
  AI_QUEUE_NAME,
  async (job) => {
    const data = job.data;

    if (data.kind === 'chat') {
      const completion = await generateChatCompletion({
        message: data.message,
        history: data.history,
        systemPrompt: data.systemPrompt,
      });

      const assistantMessage = await saveChatMessage({
        projectId: data.projectId,
        userId: null,
        role: 'assistant',
        content: completion.content,
        metrics: {
          provider: completion.provider,
          model: completion.model,
          prompt: data.message,
          response: completion.content,
          latencyMs: completion.latencyMs,
          promptTokens: completion.promptTokens,
          completionTokens: completion.completionTokens,
          totalTokens: completion.totalTokens,
          retryCount: completion.retryCount,
          errorStatus: false,
        },
      });

      await createAiEvaluation({
        projectId: data.projectId,
        featureType: 'chat',
        sourceId: assistantMessage.id,
        inputText: data.message,
        actualOutput: completion.content,
        latencyMs: completion.latencyMs,
        model: completion.model,
        notes: 'Queued AI chat evaluation sample; quality scores are pending review.',
      });

      return {
        kind: 'chat',
        id: assistantMessage.id,
        role: 'assistant',
        content: assistantMessage.content,
        timestamp: assistantMessage.createdAt,
      };
    }

    const startedAt = Date.now();
    const architectResult = await runArchitectGraph({
      requirement: data.requirement,
      projectName: data.projectName,
      projectDescription: data.projectDescription,
      techStack: data.techStack,
      architecturalGuidelines: data.architecturalGuidelines,
      existingTasks: data.existingTasks,
      repoCodeContext: data.repoCodeContext,
    });

    const tasks = architectResult.tasks.map((task, generationIndex) => ({
      title: task.title,
      description: task.description,
      priority: task.priority,
      storyPoints: task.storyPoints,
      tags: task.tags,
      dependsOnTaskIndices: task.dependsOnTaskIndices,
      generationIndex,
    }));

    const result = { tasks, reasoning: architectResult.reasoning };

    await saveGeneration({
      projectId: data.projectId,
      userId: data.userId,
      requirement: data.requirement,
      generatedTasks: tasks,
      reasoning: result.reasoning,
    });

    await createAiEvaluation({
      projectId: data.projectId,
      featureType: 'architect',
      inputText: data.requirement,
      actualOutput: JSON.stringify(result),
      latencyMs: Date.now() - startedAt,
      model: process.env.AI_PROVIDER || 'configured-provider',
      notes: 'Queued Architect Agent evaluation sample; quality scores are pending review.',
    });

    return { kind: 'architect', ...result };
  },
  { connection: getRedisConnection(), concurrency: 2 },
);

worker.on('ready', () => console.log('[ai-worker] Ready'));
worker.on('completed', (job) => console.log(`[ai-worker] Completed ${job.id}`));
worker.on('failed', (job, error) => console.error(`[ai-worker] Failed ${job?.id}:`, error.message));

async function shutdown() {
  await worker.close();
  await getRedisConnection().quit();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
