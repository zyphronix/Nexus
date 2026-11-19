import { desc, eq } from 'drizzle-orm';
import { db } from '../client';
import { aiEvaluations } from '../schema';
import type { AiEvaluation } from '../schema';

function generateId(): string {
  return crypto.randomUUID();
}

export async function createAiEvaluation(input: {
  projectId: string;
  featureType: string;
  sourceId?: string;
  inputText: string;
  expectedOutput?: string;
  actualOutput: string;
  groundingScore?: number;
  relevanceScore?: number;
  accepted?: boolean;
  latencyMs?: number;
  model?: string;
  notes?: string;
}): Promise<AiEvaluation> {
  const [evaluation] = await db
    .insert(aiEvaluations)
    .values({ id: generateId(), ...input })
    .returning();
  return evaluation;
}

export async function getAiEvaluations(
  projectId: string,
  featureType?: string,
  limit = 100,
): Promise<AiEvaluation[]> {
  const rows = await db
    .select()
    .from(aiEvaluations)
    .where(eq(aiEvaluations.projectId, projectId))
    .orderBy(desc(aiEvaluations.createdAt))
    .limit(limit);
  return featureType ? rows.filter((row) => row.featureType === featureType) : rows;
}
