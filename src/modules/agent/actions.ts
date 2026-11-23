'use server';

import type {
  TaskGenerationRequest,
  TaskGenerationResponse,
  ApiResponse,
  GeneratedTask,
} from '@/types';
import type { Task } from '@/core/db/schema';
import { getAuthUser, requireRole } from '@/core/auth';
import { getGenerationHistory as dbGetGenerationHistory } from '@/core/db/queries';
import { bulkCreateTasks } from '@/core/db/queries';
import { saveGeneration, createAiEvaluation } from '@/core/db/queries';
import { getProjectById } from '@/core/db/queries';
import { addTaskDependency } from '@/core/db/queries';
import { retrieveRelevantTasks } from '@/modules/rag/retriever';
import { runArchitectGraph } from '@/modules/architect/graph';
import { consumeRedisFixedWindowLimit } from '@/core/redis/rate-limit';

/**
 * Generate tasks from a requirement using the LangGraph architect agent.
 * The agent performs a Plan → Critique → Finalize loop for high-quality decomposition.
 */
export async function generateTasks(
  request: TaskGenerationRequest
): Promise<ApiResponse<TaskGenerationResponse>> {
  try {
    const user = await getAuthUser();
    await requireRole(user.id, request.projectId, 'member');

    // Fetch project context for the architect agent
    const project = await getProjectById(request.projectId);

    // RAG: retrieve existing tasks so the agent avoids duplicates
    let existingTasksContext = '';
    try {
      const relevantTasks = await retrieveRelevantTasks(
        request.requirement,
        { projectId: request.projectId },
        15
      );
      if (relevantTasks.length > 0) {
        existingTasksContext = relevantTasks
          .map(
            (t) => `- [${t.status}/${t.priority}] ${t.title}${t.description ? `: ${t.description}` : ''}`
          )
          .join('\n');
      }
    } catch (err) {
      console.warn('RAG retrieval failed for agent, continuing without context:', err);
    }

    // RAG: retrieve relevant code chunks from connected GitHub repo (if any)
    let repoCodeContext = '';
    try {
      const { retrieveRelevantCodeChunks } = await import('@/modules/rag/code-retriever');
      const codeChunks = await retrieveRelevantCodeChunks(
        request.requirement,
        { projectId: request.projectId },
        6
      );
      if (codeChunks.length > 0) {
        repoCodeContext = codeChunks
          .map((c) => `--- ${c.filepath} ---\n${c.text}`)
          .join('\n\n');
      }
    } catch (err) {
      console.warn('Code RAG retrieval failed for agent, continuing without code context:', err);
    }

    // Fetch implementation plan for architect context
    let planContext = '';
    try {
      const { getActivePlanContent } = await import('@/core/db/queries/roadmap');
      const planContent = await getActivePlanContent(request.projectId);
      if (planContent) {
        planContext = planContent;
      }
    } catch (err) {
      console.warn('Failed to fetch plan for agent context:', err);
    }

    // Combine architectural guidelines with plan context
    const combinedGuidelines = [
      request.architecturalGuidelines ?? project?.architecturalGuidelines ?? '',
      planContext ? `\n\nImplementation Plan / Roadmap:\n${planContext}` : '',
    ].filter(Boolean).join('');

    const architectRateLimit = await consumeRedisFixedWindowLimit({
      key: `nexus:architect-rate:${user.id}:${request.projectId}`,
      limit: Number(process.env.ARCHITECT_RATE_LIMIT_REQUESTS || 5),
      windowSeconds: Number(process.env.ARCHITECT_RATE_LIMIT_WINDOW_SECONDS || 300),
    });
    if (!architectRateLimit.allowed) {
      return {
        success: false,
        error: `Architect generation limit reached. Retry after ${architectRateLimit.retryAfterSeconds} seconds.`,
      };
    }

    const generationStartedAt = Date.now();
    const architectResult = await runArchitectGraph({
      requirement: request.requirement,
      projectName: project?.name,
      projectDescription: project?.description ?? undefined,
      techStack: request.techStack ?? project?.techStack ?? [],
      architecturalGuidelines: combinedGuidelines || undefined,
      existingTasks: existingTasksContext || undefined,
      repoCodeContext: repoCodeContext || undefined,
    });

    const generatedTasks: GeneratedTask[] = architectResult.tasks.map((task, generationIndex) => ({
      title: task.title,
      description: task.description,
      priority: task.priority,
      storyPoints: task.storyPoints,
      tags: task.tags,
      dependsOnTaskIndices: task.dependsOnTaskIndices,
      generationIndex,
    }));

    const result: TaskGenerationResponse = {
      tasks: generatedTasks,
      reasoning: architectResult.reasoning,
    };

    try {
      await createAiEvaluation({
        projectId: request.projectId,
        featureType: 'architect',
        inputText: request.requirement,
        actualOutput: JSON.stringify(result),
        latencyMs: Date.now() - generationStartedAt,
        model: process.env.AI_PROVIDER || 'configured-provider',
        notes: 'Synchronous Architect Agent evaluation sample; quality scores are pending review.',
      });
    } catch (evaluationError) {
      console.warn('Failed to record architect evaluation sample:', evaluationError);
    }

    await saveGeneration({
      projectId: request.projectId,
      userId: user.id,
      requirement: request.requirement,
      generatedTasks: result.tasks,
      reasoning: result.reasoning,
    });

    return { success: true, data: result };
  } catch (error) {
    console.error('Failed to generate tasks:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to generate tasks';
    return { success: false, error: message };
  }
}

/**
 * Accept generated tasks and create them in the project.
 * Sets ai_generated flag and stores AI metadata.
 */
export async function acceptGeneratedTasks(
  projectId: string,
  tasks: GeneratedTask[]
): Promise<ApiResponse<Task[]>> {
  try {
    const user = await getAuthUser();
    await requireRole(user.id, projectId, 'member');

    const createdTasks = await bulkCreateTasks(
      tasks.map((t) => ({
        projectId,
        title: t.title,
        description: t.description,
        priority: t.priority,
        storyPoints: t.storyPoints,
        tags: t.tags,
        aiGenerated: true,
        aiMetadata: {
          source: 'architect-agent',
          generatedAt: new Date().toISOString(),
        },
      })),
      user.id
    );

    const acceptedIndexToTaskId = new Map(
      tasks.map((task, index) => [task.generationIndex ?? index, createdTasks[index].id]),
    );

    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index];
      const taskId = createdTasks[index]?.id;
      if (!taskId) continue;

      for (const dependencyIndex of task.dependsOnTaskIndices ?? []) {
        const dependsOnTaskId = acceptedIndexToTaskId.get(dependencyIndex);
        if (!dependsOnTaskId || dependsOnTaskId === taskId) continue;
        await addTaskDependency({
          projectId,
          taskId,
          dependsOnTaskId,
          userId: user.id,
        });
      }
    }

    return { success: true, data: createdTasks };
  } catch (error) {
    console.error('Failed to accept tasks:', error);
    return { success: false, error: 'Failed to accept tasks' };
  }
}

/**
 * Get the generation history for a project.
 */
export async function getGenerationHistory(
  projectId: string
): Promise<
  ApiResponse<
    Array<{
      id: string;
      requirement: string;
      taskCount: number;
      createdAt: Date;
    }>
  >
> {
  try {
    const user = await getAuthUser();
    await requireRole(user.id, projectId, 'member');
    const history = await dbGetGenerationHistory(projectId);

    return {
      success: true,
      data: history.map((g) => ({
        id: g.id,
        requirement: g.requirement,
        taskCount: Array.isArray(g.generatedTasks)
          ? g.generatedTasks.length
          : 0,
        createdAt: g.createdAt,
      })),
    };
  } catch (error) {
    console.error('Failed to fetch generation history:', error);
    return { success: false, error: 'Failed to fetch generation history' };
  }
}
