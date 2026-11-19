import { db } from '@/core/db/client';
import { tasks } from '@/core/db/schema';
import { and, eq, ne } from 'drizzle-orm';
import { generateChatCompletion } from '@/core/ai/chat';
import { createAiEvaluation } from '@/core/db/queries';

const SYSTEM_PROMPT = `You are an assistant that links Git commits to project tasks.
You will be given a commit message, changed files, and OPEN tasks.
Return only JSON in this exact shape:
{"matches":[{"taskId":"id1","confidence":0.0,"reason":"short explanation"}]}
Rules:
- Include a task only when the commit clearly delivers what the task asks for.
- Use confidence from 0 to 1.
- Use high confidence (0.90+) only when the evidence is explicit.
- If unsure, return an empty matches array.
- Do not wrap JSON in markdown or add commentary.`;

export type CommitMatchInput = {
  projectId: string;
  commitMessage: string;
  filesChanged: string[];
};

export type CommitTaskMatch = {
  taskId: string;
  confidence: number;
  reason: string;
};

export async function matchCommitToTasks(
  input: CommitMatchInput
): Promise<CommitTaskMatch[]> {
  const startedAt = Date.now();
  // Load open tasks (status != done)
  const openTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
    })
    .from(tasks)
    .where(and(eq(tasks.projectId, input.projectId), ne(tasks.status, 'done')));

  if (openTasks.length === 0) return [];

  const taskList = openTasks
    .map(
      (t) =>
        `- id: ${t.id}\n  title: ${t.title}${t.description ? `\n  description: ${t.description.slice(0, 300)}` : ''}`
    )
    .join('\n');

  const filesPreview = input.filesChanged.slice(0, 20).join('\n');

  const userMessage = `Commit message:
${input.commitMessage}

Files changed (${input.filesChanged.length}):
${filesPreview}

Open tasks:
${taskList}

Which tasks does this commit complete? Respond with JSON only.`;

  let completion;
  try {
    completion = await generateChatCompletion({
      message: userMessage,
      history: [],
      systemPrompt: SYSTEM_PROMPT,
    });
  } catch (error) {
    console.warn('[commit-matcher] LLM call failed:', error);
    return [];
  }

  try {
    await createAiEvaluation({
      projectId: input.projectId,
      featureType: 'commit_matcher',
      inputText: `${input.commitMessage}\n${input.filesChanged.join('\n')}`,
      actualOutput: completion.content,
      latencyMs: Date.now() - startedAt,
      model: completion.model,
      notes: 'Automatically captured; match precision requires human review labels.',
    });
  } catch (evaluationError) {
    console.warn('Failed to record commit matcher evaluation sample:', evaluationError);
  }

  const jsonMatch = completion.content.trim().match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      matches?: unknown;
      taskIds?: unknown;
    };
    const validIds = new Set(openTasks.map((t) => t.id));
    if (Array.isArray(parsed.matches)) {
      return parsed.matches.flatMap((match) => {
        if (!match || typeof match !== 'object') return [];
        const candidate = match as Record<string, unknown>;
        const taskId = candidate.taskId;
        const confidence = candidate.confidence;
        if (
          typeof taskId !== 'string' ||
          !validIds.has(taskId) ||
          typeof confidence !== 'number' ||
          !Number.isFinite(confidence)
        ) {
          return [];
        }
        return [{
          taskId,
          confidence: Math.max(0, Math.min(1, confidence)),
          reason: typeof candidate.reason === 'string' ? candidate.reason.slice(0, 500) : '',
        }];
      });
    }

    if (Array.isArray(parsed.taskIds)) {
      return parsed.taskIds.flatMap((taskId) =>
        typeof taskId === 'string' && validIds.has(taskId)
          ? [{ taskId, confidence: 1, reason: 'Validated legacy matcher result.' }]
          : [],
      );
    }
  } catch (error) {
    console.warn('[commit-matcher] Invalid LLM JSON:', error);
    return [];
  }

  return [];
}
