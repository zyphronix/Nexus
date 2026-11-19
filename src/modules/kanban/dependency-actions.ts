'use server';

import type { ApiResponse } from '@/types';
import type { TaskDependency } from '@/core/db/schema';
import { getAuthUser, requireRole } from '@/core/auth';
import {
  addTaskDependency,
  getCriticalPath,
  getTaskDependencies,
  removeTaskDependency,
  type CriticalPath,
  type TaskDependencyWithTasks,
} from '@/core/db/queries';

export async function getDependencies(
  projectId: string,
): Promise<ApiResponse<TaskDependencyWithTasks[]>> {
  try {
    const user = await getAuthUser();
    await requireRole(user.id, projectId, 'member');
    return { success: true, data: await getTaskDependencies(projectId) };
  } catch (error) {
    console.error('Failed to fetch task dependencies:', error);
    return { success: false, error: 'Failed to fetch task dependencies' };
  }
}

export async function createDependency(input: {
  projectId: string;
  taskId: string;
  dependsOnTaskId: string;
}): Promise<ApiResponse<TaskDependency>> {
  try {
    const user = await getAuthUser();
    await requireRole(user.id, input.projectId, 'member');
    const dependency = await addTaskDependency({ ...input, userId: user.id });
    return { success: true, data: dependency };
  } catch (error) {
    console.error('Failed to create task dependency:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create dependency',
    };
  }
}

export async function deleteDependency(input: {
  projectId: string;
  taskId: string;
  dependsOnTaskId: string;
}): Promise<ApiResponse<void>> {
  try {
    const user = await getAuthUser();
    await requireRole(user.id, input.projectId, 'member');
    await removeTaskDependency(input);
    return { success: true };
  } catch (error) {
    console.error('Failed to delete task dependency:', error);
    return { success: false, error: 'Failed to delete dependency' };
  }
}

export async function getProjectCriticalPath(
  projectId: string,
): Promise<ApiResponse<CriticalPath>> {
  try {
    const user = await getAuthUser();
    await requireRole(user.id, projectId, 'member');
    return { success: true, data: await getCriticalPath(projectId) };
  } catch (error) {
    console.error('Failed to calculate critical path:', error);
    return { success: false, error: 'Failed to calculate critical path' };
  }
}
