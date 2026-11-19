import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../client';
import { taskDependencies, tasks } from '../schema';
import type { Task, TaskDependency } from '../schema';
import {
  calculateCriticalPath,
  wouldCreateCycle,
} from '../dependency-graph';

export type TaskDependencyWithTasks = TaskDependency & {
  task: Pick<Task, 'id' | 'title' | 'status' | 'storyPoints'>;
  dependsOnTask: Pick<Task, 'id' | 'title' | 'status' | 'storyPoints'>;
};

export type CriticalPath = {
  taskIds: string[];
  totalStoryPoints: number;
};

const blockingTasks = alias(tasks, 'blocking_tasks');

function generateId(): string {
  return crypto.randomUUID();
}

export async function getTaskDependencies(
  projectId: string,
): Promise<TaskDependencyWithTasks[]> {
  const rows = await db
    .select({
      dependency: taskDependencies,
      task: {
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        storyPoints: tasks.storyPoints,
      },
      dependsOnTask: {
        id: blockingTasks.id,
        title: blockingTasks.title,
        status: blockingTasks.status,
        storyPoints: blockingTasks.storyPoints,
      },
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(taskDependencies.taskId, tasks.id))
    .innerJoin(
      blockingTasks,
      eq(taskDependencies.dependsOnTaskId, blockingTasks.id),
    )
    .where(eq(taskDependencies.projectId, projectId));

  return rows.map((row) => ({
    ...row.dependency,
    task: row.task,
    dependsOnTask: row.dependsOnTask,
  }));
}

export async function addTaskDependency(params: {
  projectId: string;
  taskId: string;
  dependsOnTaskId: string;
  userId: string;
}): Promise<TaskDependency> {
  if (params.taskId === params.dependsOnTaskId) {
    throw new Error('A task cannot depend on itself.');
  }

  const projectTasks = await db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, params.projectId),
        eq(tasks.id, params.taskId),
      ),
    );
  const dependencyTasks = await db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, params.projectId),
        eq(tasks.id, params.dependsOnTaskId),
      ),
    );

  if (projectTasks.length === 0 || dependencyTasks.length === 0) {
    throw new Error('Both tasks must belong to the same project.');
  }

  const existing = await db
    .select()
    .from(taskDependencies)
    .where(
      and(
        eq(taskDependencies.projectId, params.projectId),
        eq(taskDependencies.taskId, params.taskId),
        eq(taskDependencies.dependsOnTaskId, params.dependsOnTaskId),
      ),
    );
  if (existing.length > 0) {
    return existing[0];
  }

  const allDependencies = await db
    .select()
    .from(taskDependencies)
    .where(eq(taskDependencies.projectId, params.projectId));
  if (wouldCreateCycle(params.taskId, params.dependsOnTaskId, allDependencies)) {
    throw new Error('This dependency would create a cycle.');
  }

  const [created] = await db
    .insert(taskDependencies)
    .values({
      id: generateId(),
      projectId: params.projectId,
      taskId: params.taskId,
      dependsOnTaskId: params.dependsOnTaskId,
      createdBy: params.userId,
    })
    .returning();

  return created;
}

export async function removeTaskDependency(params: {
  projectId: string;
  taskId: string;
  dependsOnTaskId: string;
}): Promise<void> {
  await db
    .delete(taskDependencies)
    .where(
      and(
        eq(taskDependencies.projectId, params.projectId),
        eq(taskDependencies.taskId, params.taskId),
        eq(taskDependencies.dependsOnTaskId, params.dependsOnTaskId),
      ),
    );
}

export async function getCriticalPath(projectId: string): Promise<CriticalPath> {
  const [projectTasks, dependencies] = await Promise.all([
    db.select().from(tasks).where(eq(tasks.projectId, projectId)),
    db
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.projectId, projectId)),
  ]);

  const best = calculateCriticalPath(projectTasks, dependencies);

  return {
    taskIds: best.taskIds,
    totalStoryPoints: best.totalStoryPoints,
  };
}
