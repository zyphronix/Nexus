export type DependencyEdge = {
  taskId: string;
  dependsOnTaskId: string;
};

export type WeightedTask = {
  id: string;
  storyPoints: number | null;
  status: string;
};

export function wouldCreateCycle(
  taskId: string,
  dependsOnTaskId: string,
  dependencies: DependencyEdge[],
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const dependency of dependencies) {
    adjacency.set(dependency.taskId, [
      ...(adjacency.get(dependency.taskId) ?? []),
      dependency.dependsOnTaskId,
    ]);
  }

  const visited = new Set<string>();
  const stack = [dependsOnTaskId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

export function calculateCriticalPath(
  tasks: WeightedTask[],
  dependencies: DependencyEdge[],
): { taskIds: string[]; totalStoryPoints: number } {
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const incoming = new Map<string, string[]>();
  for (const dependency of dependencies) {
    if (!taskMap.has(dependency.taskId) || !taskMap.has(dependency.dependsOnTaskId)) continue;
    incoming.set(dependency.taskId, [
      ...(incoming.get(dependency.taskId) ?? []),
      dependency.dependsOnTaskId,
    ]);
  }

  const memo = new Map<string, { score: number; path: string[] }>();
  const visiting = new Set<string>();
  const longestPath = (taskId: string): { score: number; path: string[] } => {
    const cached = memo.get(taskId);
    if (cached) return cached;
    if (visiting.has(taskId)) throw new Error('Dependency graph contains a cycle.');
    visiting.add(taskId);
    const task = taskMap.get(taskId)!;
    const blockers = (incoming.get(taskId) ?? [])
      .map(longestPath)
      .sort((left, right) => right.score - left.score);
    const bestBlocker = blockers[0];
    const result = {
      score: (task.storyPoints ?? 1) + (bestBlocker?.score ?? 0),
      path: [...(bestBlocker?.path ?? []), taskId],
    };
    visiting.delete(taskId);
    memo.set(taskId, result);
    return result;
  };

  const candidates = tasks
    .filter((task) => task.status !== 'done')
    .map((task) => longestPath(task.id))
    .sort((left, right) => right.score - left.score);
  const best = candidates[0];
  return {
    taskIds: best?.path ?? [],
    totalStoryPoints: best?.score ?? 0,
  };
}
