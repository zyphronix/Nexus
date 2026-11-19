'use server';

import type { ApiResponse } from '@/types';
import type { AiEvaluation } from '@/core/db/schema';
import { getAuthUser, requireRole } from '@/core/auth';
import { createAiEvaluation, getAiEvaluations } from '@/core/db/queries';

export async function recordAiEvaluation(input: {
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
}): Promise<ApiResponse<AiEvaluation>> {
  try {
    const user = await getAuthUser();
    await requireRole(user.id, input.projectId, 'member');
    const evaluation = await createAiEvaluation(input);
    return { success: true, data: evaluation };
  } catch (error) {
    console.error('Failed to record AI evaluation:', error);
    return { success: false, error: 'Failed to record AI evaluation' };
  }
}

export async function getEvaluationHistory(
  projectId: string,
  featureType?: string,
): Promise<ApiResponse<AiEvaluation[]>> {
  try {
    const user = await getAuthUser();
    await requireRole(user.id, projectId, 'member');
    return { success: true, data: await getAiEvaluations(projectId, featureType) };
  } catch (error) {
    console.error('Failed to fetch AI evaluations:', error);
    return { success: false, error: 'Failed to fetch AI evaluations' };
  }
}
